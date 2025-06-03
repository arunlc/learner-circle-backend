const express = require('express');
const { Session, Batch, Course, Enrollment, User } = require('../models');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

// Apply auth middleware and student role guard
router.use(authMiddleware);
router.use(roleGuard(['student']));

// Student dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get student's active enrollments
    const enrollments = await Enrollment.findAll({
      where: {
        student_id: studentId,
        status: 'Active'
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { model: User, as: 'currentTutor' }
          ]
        }
      ]
    });

    if (enrollments.length === 0) {
      return res.json({
        nextSession: null,
        progress: [],
        recentRecordings: []
      });
    }

    const batchIds = enrollments.map(e => e.batch_id);

    // Get next upcoming session
    const nextSession = await Session.findOne({
      where: {
        batch_id: { [Op.in]: batchIds },
        scheduled_datetime: { [Op.gt]: new Date() },
        status: 'Scheduled'
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { model: User, as: 'currentTutor' }
          ]
        }
      ],
      order: [['scheduled_datetime', 'ASC']]
    });

    // Get recent completed sessions with recordings
    const recentRecordings = await Session.findAll({
      where: {
        batch_id: { [Op.in]: batchIds },
        status: 'Completed',
        recording_link: { [Op.ne]: null }
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        }
      ],
      order: [['scheduled_datetime', 'DESC']],
      limit: 5
    });

    // Calculate progress for each enrollment
    const progress = await Promise.all(enrollments.map(async (enrollment) => {
      const totalSessions = await Session.count({
        where: { batch_id: enrollment.batch_id }
      });
      
      const completedSessions = await Session.count({
        where: {
          batch_id: enrollment.batch_id,
          status: 'Completed'
        }
      });

      return {
        batch: enrollment.batch,
        total_sessions: totalSessions,
        completed_sessions: completedSessions,
        progress_percentage: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0
      };
    }));

    // Filter tutor contact information
    const nextSessionResponse = nextSession ? {
      ...nextSession.toJSON(),
      batch: {
        ...nextSession.batch.toJSON(),
        currentTutor: nextSession.batch.currentTutor ? nextSession.batch.currentTutor.getSecureView('student') : null
      }
    } : null;

    const progressResponse = progress.map(p => ({
      ...p,
      batch: {
        ...p.batch.toJSON(),
        currentTutor: p.batch.currentTutor ? p.batch.currentTutor.getSecureView('student') : null
      }
    }));

    res.json({
      nextSession: nextSessionResponse,
      progress: progressResponse,
      recentRecordings
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get student's sessions
router.get('/sessions', async (req, res) => {
  try {
    const studentId = req.user.id;
    const { status, from_date, to_date } = req.query;

    // Get student's batch IDs
    const enrollments = await Enrollment.findAll({
      where: { student_id: studentId, status: 'Active' },
      attributes: ['batch_id']
    });

    if (enrollments.length === 0) {
      return res.json([]);
    }

    const batchIds = enrollments.map(e => e.batch_id);
    const where = { batch_id: { [Op.in]: batchIds } };

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
            { model: User, as: 'currentTutor' }
          ]
        }
      ],
      order: [['scheduled_datetime', 'ASC']]
    });

    // Filter tutor contact information
    const sessionsResponse = sessions.map(session => ({
      ...session.toJSON(),
      batch: {
        ...session.batch.toJSON(),
        currentTutor: session.batch.currentTutor ? session.batch.currentTutor.getSecureView('student') : null
      }
    }));

    res.json(sessionsResponse);
  } catch (error) {
    console.error('Fetch student sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get specific session details
router.get('/sessions/:id', async (req, res) => {
  try {
    const studentId = req.user.id;
    const sessionId = req.params.id;

    // Verify student has access to this session
    const enrollment = await Enrollment.findOne({
      where: { student_id: studentId, status: 'Active' },
      include: [{
        model: Batch,
        as: 'batch',
        include: [{
          model: Session,
          as: 'sessions',
          where: { id: sessionId }
        }]
      }]
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    const session = await Session.findOne({
      where: { id: sessionId },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { model: User, as: 'currentTutor' }
          ]
        }
      ]
    });

    // Filter tutor contact information
    const sessionResponse = {
      ...session.toJSON(),
      batch: {
        ...session.batch.toJSON(),
        currentTutor: session.batch.currentTutor ? session.batch.currentTutor.getSecureView('student') : null
      }
    };

    res.json(sessionResponse);
  } catch (error) {
    console.error('Fetch session details error:', error);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// Get session recordings
router.get('/recordings', async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get student's batch IDs
    const enrollments = await Enrollment.findAll({
      where: { student_id: studentId, status: 'Active' },
      attributes: ['batch_id']
    });

    if (enrollments.length === 0) {
      return res.json([]);
    }

    const batchIds = enrollments.map(e => e.batch_id);

    const recordings = await Session.findAll({
      where: {
        batch_id: { [Op.in]: batchIds },
        status: 'Completed',
        recording_link: { [Op.ne]: null }
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        }
      ],
      order: [['scheduled_datetime', 'DESC']],
      attributes: ['id', 'session_number', 'curriculum_topic', 'scheduled_datetime', 'recording_link']
    });

    res.json(recordings);
  } catch (error) {
    console.error('Fetch recordings error:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

// Get learning progress
router.get('/progress', async (req, res) => {
  try {
    const studentId = req.user.id;

    const enrollments = await Enrollment.findAll({
      where: { student_id: studentId, status: 'Active' },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            {
              model: Session,
              as: 'sessions',
              attributes: ['id', 'session_number', 'status', 'scheduled_datetime', 'attendance']
            }
          ]
        }
      ]
    });

    const progress = await Promise.all(enrollments.map(async (enrollment) => {
      const sessions = enrollment.batch.sessions;
      const totalSessions = sessions.length;
      const completedSessions = sessions.filter(s => s.status === 'Completed').length;
      
      // Calculate attendance rate
      const attendedSessions = sessions.filter(s => 
        s.status === 'Completed' && 
        s.attendance && 
        s.attendance[studentId] === 'present'
      ).length;

      const attendanceRate = completedSessions > 0 ? Math.round((attendedSessions / completedSessions) * 100) : 0;

      return {
        batch: {
          id: enrollment.batch.id,
          batch_name: enrollment.batch.batch_name,
          course: enrollment.batch.course
        },
        total_sessions: totalSessions,
        completed_sessions: completedSessions,
        attended_sessions: attendedSessions,
        progress_percentage: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
        attendance_rate: attendanceRate,
        enrollment_date: enrollment.enrollment_date,
        sessions: sessions.map(s => ({
          session_number: s.session_number,
          status: s.status,
          scheduled_datetime: s.scheduled_datetime,
          attended: s.attendance && s.attendance[studentId] === 'present'
        }))
      };
    }));

    res.json(progress);
  } catch (error) {
    console.error('Fetch progress error:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Update student profile (limited fields)
router.put('/profile', async (req, res) => {
  try {
    const studentId = req.user.id;
    const { first_name, last_name, timezone } = req.body;

    const allowedUpdates = {};
    if (first_name) allowedUpdates.first_name = first_name;
    if (last_name) allowedUpdates.last_name = last_name;
    if (timezone) allowedUpdates.timezone = timezone;

    await User.update(allowedUpdates, {
      where: { id: studentId }
    });

    const updatedUser = await User.findByPk(studentId);
    const userResponse = updatedUser.getSecureView('student');

    res.json({ message: 'Profile updated successfully', user: userResponse });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});
router.get('/materials', async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get student's active enrollments with batch and course info
    const enrollments = await Enrollment.findAll({
      where: {
        student_id: studentId,
        status: 'Active'
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { model: User, as: 'currentTutor' },
            {
              model: Session,
              as: 'sessions',
              attributes: ['id', 'session_number', 'curriculum_topic', 'scheduled_datetime', 'status'],
              order: [['session_number', 'ASC']]
            }
          ]
        }
      ]
    });

    if (enrollments.length === 0) {
      return res.json({
        message: 'No active enrollments found',
        batches: []
      });
    }

    const batchMaterials = enrollments.map(enrollment => {
      const batch = enrollment.batch;
      const materials = batch.getStudentMaterials();
      
      // Organize session materials with session info
      const sessionMaterialsWithInfo = {};
      if (batch.sessions) {
        batch.sessions.forEach(session => {
          const sessionNum = session.session_number.toString();
          if (materials.session_materials[sessionNum]) {
            sessionMaterialsWithInfo[sessionNum] = {
              session_info: {
                id: session.id,
                session_number: session.session_number,
                topic: session.curriculum_topic || `Session ${session.session_number}`,
                scheduled_datetime: session.scheduled_datetime,
                status: session.status
              },
              materials: materials.session_materials[sessionNum]
            };
          }
        });
      }

      return {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        course: {
          id: batch.course.id,
          name: batch.course.name,
          skill_level: batch.course.skill_level
        },
        tutor: batch.currentTutor ? {
          name: `${batch.currentTutor.first_name} ${batch.currentTutor.last_name[0]}.`
        } : null,
        enrollment_date: enrollment.enrollment_date,
        materials: {
          course_materials: materials.course_materials,
          session_materials: sessionMaterialsWithInfo
        }
      };
    });

    res.json({
      student_name: `${req.user.first_name} ${req.user.last_name}`,
      batches: batchMaterials
    });

  } catch (error) {
    console.error('Student materials error:', error);
    res.status(500).json({ error: 'Failed to fetch study materials' });
  }
});

// Get materials for specific batch (if student is enrolled)
router.get('/materials/:batchId', async (req, res) => {
  try {
    const studentId = req.user.id;
    const batchId = req.params.batchId;

    // Verify student is enrolled in this batch
    const enrollment = await Enrollment.findOne({
      where: {
        student_id: studentId,
        batch_id: batchId,
        status: 'Active'
      },
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { model: User, as: 'currentTutor' },
            {
              model: Session,
              as: 'sessions',
              attributes: ['id', 'session_number', 'curriculum_topic', 'scheduled_datetime', 'status'],
              order: [['session_number', 'ASC']]
            }
          ]
        }
      ]
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Batch not found or access denied' });
    }

    const batch = enrollment.batch;
    const materials = batch.getStudentMaterials();

    // Add session info to session materials
    const sessionMaterialsWithInfo = {};
    if (batch.sessions) {
      batch.sessions.forEach(session => {
        const sessionNum = session.session_number.toString();
        sessionMaterialsWithInfo[sessionNum] = {
          session_info: {
            id: session.id,
            session_number: session.session_number,
            topic: session.curriculum_topic || `Session ${session.session_number}`,
            scheduled_datetime: session.scheduled_datetime,
            status: session.status
          },
          materials: materials.session_materials[sessionNum] || []
        };
      });
    }

    res.json({
      batch: {
        id: batch.id,
        batch_name: batch.batch_name,
        course: {
          id: batch.course.id,
          name: batch.course.name,
          description: batch.course.description,
          skill_level: batch.course.skill_level
        },
        tutor: batch.currentTutor ? {
          name: `${batch.currentTutor.first_name} ${batch.currentTutor.last_name[0]}.`
        } : null,
        enrollment_date: enrollment.enrollment_date
      },
      materials: {
        course_materials: materials.course_materials,
        session_materials: sessionMaterialsWithInfo
      }
    });

  } catch (error) {
    console.error('Batch materials error:', error);
    res.status(500).json({ error: 'Failed to fetch batch materials' });
  }
});

// Track material access (optional - for analytics)
router.post('/materials/:materialId/access', async (req, res) => {
  try {
    const studentId = req.user.id;
    const materialId = req.params.materialId;
    const { batch_id, session_number } = req.body;

    // Verify student has access to this material
    const enrollment = await Enrollment.findOne({
      where: {
        student_id: studentId,
        batch_id: batch_id,
        status: 'Active'
      },
      include: [{ model: Batch, as: 'batch' }]
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const batch = enrollment.batch;
    const materials = batch.materials || { course_materials: [], session_materials: {} };

    // Find the material
    let materialFound = false;
    
    // Check course materials
    const courseMaterial = materials.course_materials.find(mat => mat.id === materialId);
    if (courseMaterial) materialFound = true;
    
    // Check session materials
    if (!materialFound && session_number) {
      const sessionMaterials = materials.session_materials[session_number] || [];
      const sessionMaterial = sessionMaterials.find(mat => mat.id === materialId);
      if (sessionMaterial) materialFound = true;
    }

    if (!materialFound) {
      return res.status(404).json({ error: 'Material not found or access denied' });
    }

    // Log material access (you can implement analytics here)
    // For now, just return success
    res.json({
      message: 'Material access logged',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Material access error:', error);
    res.status(500).json({ error: 'Failed to log material access' });
  }
});

module.exports = router;
