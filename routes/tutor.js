const express = require('express');
const { Session, Batch, Course, User, Enrollment } = require('../models');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

// Apply auth middleware and tutor role guard
router.use(authMiddleware);
router.use(roleGuard(['tutor']));

// Tutor dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const today = new Date();
    const todayStart = new Date(today.setHours(0,0,0,0));
    const todayEnd = new Date(today.setHours(23,59,59,999));

    // Today's sessions
    const todaySessions = await Session.findAll({
      where: {
        assigned_tutor_id: tutorId,
        scheduled_datetime: {
          [Op.between]: [todayStart, todayEnd]
        }
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        }
      ],
      order: [['scheduled_datetime', 'ASC']]
    });

    // Upcoming sessions (next 7 days)
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    
    const upcomingSessions = await Session.findAll({
      where: {
        assigned_tutor_id: tutorId,
        scheduled_datetime: {
          [Op.between]: [new Date(), weekFromNow]
        },
        status: 'Scheduled'
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        }
      ],
      order: [['scheduled_datetime', 'ASC']],
      limit: 10
    });

    // Active batches
    const activeBatches = await Batch.findAll({
      where: {
        current_tutor_id: tutorId,
        status: 'Active'
      },
      include: [
        { model: Course, as: 'course' },
        { model: Enrollment, as: 'enrollments', where: { status: 'Active' }, required: false }
      ]
    });

    res.json({
      todaySessions,
      upcomingSessions,
      activeBatches: activeBatches.map(batch => ({
        ...batch.toJSON(),
        student_count: batch.enrollments?.length || 0
      }))
    });
  } catch (error) {
    console.error('Tutor dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get tutor's sessions
router.get('/sessions', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const { status, from_date, to_date } = req.query;
    
    const where = { assigned_tutor_id: tutorId };
    
    if (status) where.status = status;
    if (from_date && to_date) {
      where.scheduled_datetime = {
        [Op.between]: [new Date(from_date), new Date(to_date)]
      };
    }

    const sessions = await Session.findAll({
      where,
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { 
              model: Enrollment, 
              as: 'enrollments', 
              where: { status: 'Active' },
              required: false,
              include: [{ model: User, as: 'student' }]
            }
          ]
        }
      ],
      order: [['scheduled_datetime', 'ASC']]
    });

    // Filter out contact information from students
    const sessionsResponse = sessions.map(session => {
      const sessionData = session.toJSON();
      if (sessionData.batch?.enrollments) {
        sessionData.batch.enrollments = sessionData.batch.enrollments.map(enrollment => ({
          ...enrollment,
          student: enrollment.student ? enrollment.student.getSecureView('tutor') : null
        }));
      }
      return sessionData;
    });

    res.json(sessionsResponse);
  } catch (error) {
    console.error('Fetch tutor sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get specific session details
router.get('/sessions/:id', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const sessionId = req.params.id;

    const session = await Session.findOne({
      where: {
        id: sessionId,
        assigned_tutor_id: tutorId
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { 
              model: Enrollment, 
              as: 'enrollments',
              where: { status: 'Active' },
              required: false,
              include: [{ model: User, as: 'student' }]
            }
          ]
        }
      ]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    // Filter student contact information
    const sessionData = session.toJSON();
    if (sessionData.batch?.enrollments) {
      sessionData.batch.enrollments = sessionData.batch.enrollments.map(enrollment => ({
        ...enrollment,
        student: enrollment.student ? enrollment.student.getSecureView('tutor') : null
      }));
    }

    res.json(sessionData);
  } catch (error) {
    console.error('Fetch session details error:', error);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// Mark session attendance
router.post('/sessions/:id/attendance', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const sessionId = req.params.id;
    const { attendance } = req.body;

    const session = await Session.findOne({
      where: {
        id: sessionId,
        assigned_tutor_id: tutorId
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    // Update attendance
    await session.update({
      attendance,
      status: 'Completed'
    });

    res.json({ message: 'Attendance marked successfully', session });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Add session notes
router.post('/sessions/:id/notes', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const sessionId = req.params.id;
    const { notes } = req.body;

    const session = await Session.findOne({
      where: {
        id: sessionId,
        assigned_tutor_id: tutorId
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    await session.update({ tutor_notes: notes });

    res.json({ message: 'Notes saved successfully', session });
  } catch (error) {
    console.error('Save notes error:', error);
    res.status(500).json({ error: 'Failed to save notes' });
  }
});

// Get assigned batches
router.get('/batches', async (req, res) => {
  try {
    const tutorId = req.user.id;

    const batches = await Batch.findAll({
      where: {
        current_tutor_id: tutorId,
        status: 'Active'
      },
      include: [
        { model: Course, as: 'course' },
        { 
          model: Enrollment, 
          as: 'enrollments',
          where: { status: 'Active' },
          required: false,
          include: [{ model: User, as: 'student' }]
        },
        {
          model: Session,
          as: 'sessions',
          where: { status: ['Scheduled', 'Completed'] },
          required: false,
          order: [['session_number', 'ASC']]
        }
      ]
    });

    // Filter student contact information
    const batchesResponse = batches.map(batch => {
      const batchData = batch.toJSON();
      if (batchData.enrollments) {
        batchData.enrollments = batchData.enrollments.map(enrollment => ({
          ...enrollment,
          student: enrollment.student ? enrollment.student.getSecureView('tutor') : null
        }));
      }
      return batchData;
    });

    res.json(batchesResponse);
  } catch (error) {
    console.error('Fetch tutor batches error:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// Get curriculum materials for a batch
router.get('/materials/:batchId', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const batchId = req.params.batchId;

    const batch = await Batch.findOne({
      where: {
        id: batchId,
        current_tutor_id: tutorId
      },
      include: [{ model: Course, as: 'course' }]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found or access denied' });
    }

    // Return curriculum and any uploaded materials
    res.json({
      curriculum: batch.course.curriculum,
      materials: batch.course.curriculum || [],
      drive_folder_id: batch.drive_folder_id
    });
  } catch (error) {
    console.error('Fetch materials error:', error);
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});
// Get materials for tutor's assigned batches
router.get('/materials', async (req, res) => {
  try {
    const tutorId = req.user.id;

    const batches = await Batch.findAll({
      where: {
        current_tutor_id: tutorId,
        status: 'Active'
      },
      include: [
        { model: Course, as: 'course' },
        {
          model: Session,
          as: 'sessions',
          attributes: ['id', 'session_number', 'curriculum_topic', 'scheduled_datetime', 'status'],
          order: [['session_number', 'ASC']]
        }
      ]
    });

    const batchMaterials = batches.map(batch => {
      const materials = batch.materials || { course_materials: [], session_materials: {} };
      
      return {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        course: {
          id: batch.course.id,
          name: batch.course.name
        },
        materials: {
          course_materials: materials.course_materials,
          session_materials: materials.session_materials
        },
        sessions: batch.sessions
      };
    });

    res.json(batchMaterials);

  } catch (error) {
    console.error('Tutor materials error:', error);
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});

// Get materials for specific batch (if tutor is assigned)
router.get('/batches/:batchId/materials', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const batchId = req.params.batchId;

    const batch = await Batch.findOne({
      where: {
        id: batchId,
        current_tutor_id: tutorId
      },
      include: [
        { model: Course, as: 'course' },
        {
          model: Session,
          as: 'sessions',
          attributes: ['id', 'session_number', 'curriculum_topic', 'scheduled_datetime', 'status'],
          order: [['session_number', 'ASC']]
        }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found or access denied' });
    }

    res.json({
      batch: batch.toJSON(),
      materials: batch.materials || { course_materials: [], session_materials: {} }
    });

  } catch (error) {
    console.error('Batch materials error:', error);
    res.status(500).json({ error: 'Failed to fetch batch materials' });
  }
});

// Add material to assigned batch
router.post('/batches/:batchId/materials', [
  body('name').notEmpty().trim(),
  body('type').isIn(['document', 'video', 'audio', 'link', 'image']),
  body('url').isURL(),
  body('description').optional(),
  body('session_number').optional().isInt({ min: 1 }),
  body('is_required').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const tutorId = req.user.id;
    const batchId = req.params.batchId;
    const { name, type, url, description, session_number, is_required } = req.body;

    const batch = await Batch.findOne({
      where: {
        id: batchId,
        current_tutor_id: tutorId
      }
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found or access denied' });
    }

    const materialData = {
      name,
      type,
      url,
      description: description || '',
      is_required: is_required || false
    };

    let updatedBatch;
    if (session_number) {
      // Add to session materials
      updatedBatch = await batch.addSessionMaterial(session_number, materialData, tutorId);
    } else {
      // Add to course materials
      updatedBatch = await batch.addCourseMaterial(materialData, tutorId);
    }

    res.json({
      message: 'Material added successfully',
      batch: updatedBatch.toJSON(),
      materials: updatedBatch.materials
    });

  } catch (error) {
    console.error('Add material error:', error);
    res.status(500).json({ error: 'Failed to add material' });
  }
});

// Remove material from assigned batch
router.delete('/batches/:batchId/materials/:materialId', async (req, res) => {
  try {
    const tutorId = req.user.id;
    const { batchId, materialId } = req.params;
    const { session_number } = req.query;

    const batch = await Batch.findOne({
      where: {
        id: batchId,
        current_tutor_id: tutorId
      }
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found or access denied' });
    }

    // Verify tutor can delete this material (only materials they added)
    const materials = batch.materials || { course_materials: [], session_materials: {} };
    let canDelete = false;

    if (session_number) {
      const sessionMaterials = materials.session_materials[session_number] || [];
      const material = sessionMaterials.find(mat => mat.id === materialId);
      canDelete = material && material.added_by === tutorId;
    } else {
      const material = materials.course_materials.find(mat => mat.id === materialId);
      canDelete = material && material.added_by === tutorId;
    }

    if (!canDelete) {
      return res.status(403).json({ error: 'You can only delete materials you added' });
    }

    const updatedBatch = await batch.addSessionMaterial(session.session_number, materialData, tutorId);

    res.json({
      message: 'Material added to session successfully',
      session: session.toJSON(),
      batch: updatedBatch.toJSON(),
      materials: updatedBatch.materials
    });

  } catch (error) {
    console.error('Add session material error:', error);
    res.status(500).json({ error: 'Failed to add material to session' });
  }
});

// Get materials overview for tutor's batches
router.get('/materials/overview', async (req, res) => {
  try {
    const tutorId = req.user.id;

    const batches = await Batch.findAll({
      where: {
        current_tutor_id: tutorId,
        status: ['Active', 'Paused']
      },
      include: [{ model: Course, as: 'course' }]
    });

    const overview = batches.map(batch => {
      const materials = batch.materials || { course_materials: [], session_materials: {} };
      
      const courseMaterialsCount = materials.course_materials.length;
      const sessionMaterialsCount = Object.values(materials.session_materials)
        .reduce((sum, sessionMats) => sum + sessionMats.length, 0);

      // Count materials added by this tutor
      const tutorCourseMaterials = materials.course_materials.filter(mat => mat.added_by === tutorId).length;
      const tutorSessionMaterials = Object.values(materials.session_materials)
        .reduce((sum, sessionMats) => 
          sum + sessionMats.filter(mat => mat.added_by === tutorId).length, 0);

      return {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        course_name: batch.course.name,
        total_course_materials: courseMaterialsCount,
        total_session_materials: sessionMaterialsCount,
        my_course_materials: tutorCourseMaterials,
        my_session_materials: tutorSessionMaterials,
        total_materials: courseMaterialsCount + sessionMaterialsCount,
        my_materials: tutorCourseMaterials + tutorSessionMaterials
      };
    });

    res.json(overview);

  } catch (error) {
    console.error('Materials overview error:', error);
    res.status(500).json({ error: 'Failed to fetch materials overview' });
  }
});atch = await batch.removeMaterial(materialId, session_number);

    res.json({
      message: 'Material removed successfully',
      batch: updatedBatch.toJSON(),
      materials: updatedBatch.materials
    });

  } catch (error) {
    console.error('Remove material error:', error);
    res.status(500).json({ error: 'Failed to remove material' });
  }
});

// Add material to specific session (during or after session)
router.post('/sessions/:sessionId/materials', [
  body('name').notEmpty().trim(),
  body('type').isIn(['document', 'video', 'audio', 'link', 'image']),
  body('url').isURL(),
  body('description').optional(),
  body('is_required').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const tutorId = req.user.id;
    const sessionId = req.params.sessionId;
    const { name, type, url, description, is_required } = req.body;

    // Get session and verify tutor access
    const session = await Session.findOne({
      where: {
        id: sessionId,
        assigned_tutor_id: tutorId
      },
      include: [{ model: Batch, as: 'batch' }]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    const batch = session.batch;
    const materialData = {
      name,
      type,
      url,
      description: description || '',
      is_required: is_required || false
    };

    const updatedB

module.exports = router;
