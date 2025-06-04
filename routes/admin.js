const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, Course, Batch, Session, Enrollment } = require('../models');
const { authMiddleware, roleGuard } = require('../middleware/auth');

const router = express.Router();

// Apply auth middleware and admin role guard to all routes
router.use(authMiddleware);
router.use(roleGuard(['admin']));

// Helper function to calculate next session date following batch schedule
const calculateNextSessionDate = (batch, lastSessionDate) => {
  const schedule = batch.schedule; // [{"day": "Tuesday", "time": "18:00"}, {"day": "Friday", "time": "18:00"}]
  
  if (!schedule || schedule.length === 0) {
    // Fallback: add 7 days
    const nextDate = new Date(lastSessionDate);
    nextDate.setDate(nextDate.getDate() + 7);
    return nextDate;
  }

  const dayMap = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };

  let searchDate = new Date(lastSessionDate);
  searchDate.setDate(searchDate.getDate() + 1); // Start from next day after last session

  // Look for next available schedule slot within next 14 days
  for (let i = 0; i < 14; i++) {
    const dayName = Object.keys(dayMap).find(day => dayMap[day] === searchDate.getDay());
    const scheduleMatch = schedule.find(slot => slot.day === dayName);
    
    if (scheduleMatch) {
      const [hours, minutes] = scheduleMatch.time.split(':');
      const sessionDateTime = new Date(searchDate);
      sessionDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      
      // Make sure it's not in the past and after the last session
      if (sessionDateTime > new Date(lastSessionDate)) {
        return sessionDateTime;
      }
    }
    
    searchDate.setDate(searchDate.getDate() + 1);
  }

  // Fallback if no valid date found
  const fallbackDate = new Date(lastSessionDate);
  fallbackDate.setDate(fallbackDate.getDate() + 7);
  return fallbackDate;
};

// Dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const totalStudents = await User.count({ where: { role: 'student', is_active: true } });
    const totalTutors = await User.count({ where: { role: 'tutor', is_active: true } });
    const activeBatches = await Batch.count({ where: { status: 'Active' } });
    const totalCourses = await Course.count({ where: { is_active: true } });

    const todaySessions = await Session.count({
      where: {
        scheduled_datetime: {
          [require('sequelize').Op.between]: [
            new Date().setHours(0,0,0,0),
            new Date().setHours(23,59,59,999)
          ]
        }
      }
    });

    res.json({
      totalStudents,
      totalTutors,
      activeBatches,
      totalCourses,
      todaySessions
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Course management with status filtering
router.get('/courses', async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    
    let where = {};
    switch (status) {
      case 'active':
        where.is_active = true;
        break;
      case 'inactive':
        where.is_active = false;
        break;
      case 'all':
      default:
        // No filter
        break;
    }

    const courses = await Course.findAll({
      where,
      include: [{
        model: Batch,
        as: 'batches',
        required: false,
        include: [{
          model: Enrollment,
          as: 'enrollments',
          where: { status: 'Active' },
          required: false
        }]
      }]
    });

    // Add course statistics
    const coursesWithStats = courses.map(course => {
      const courseData = course.toJSON();
      
      // Calculate metrics
      const activeBatches = courseData.batches?.filter(batch => batch.status === 'Active') || [];
      const totalEnrollments = courseData.batches?.reduce((sum, batch) => 
        sum + (batch.enrollments?.length || 0), 0) || 0;
      const currentActiveStudents = activeBatches.reduce((sum, batch) => 
        sum + (batch.enrollments?.length || 0), 0);
      const averageBatchSize = courseData.batches?.length > 0 ? 
        Math.round(totalEnrollments / courseData.batches.length) : 0;

      courseData.metrics = {
        total_enrollments: totalEnrollments,
        current_active_students: currentActiveStudents,
        active_batches: activeBatches.length,
        average_batch_size: averageBatchSize
      };

      return courseData;
    });

    res.json(coursesWithStats);
  } catch (error) {
    console.error('Fetch courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.post('/courses', [
  body('name').notEmpty().trim(),
  body('skill_level').isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('total_sessions').isInt({ min: 1 }),
  body('curriculum').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const course = await Course.create(req.body);
    res.status(201).json(course);
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/courses/:id', [
  body('name').optional().notEmpty().trim(),
  body('skill_level').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('total_sessions').optional().isInt({ min: 1 }),
  body('session_duration_minutes').optional().isInt({ min: 15 }),
  body('description').optional(),
  body('curriculum').optional().isArray(),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const courseId = req.params.id;
    const updateData = req.body;

    const [updatedRowsCount] = await Course.update(updateData, {
      where: { id: courseId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const updatedCourse = await Course.findByPk(courseId);
    res.json({ 
      message: 'Course updated successfully', 
      course: updatedCourse 
    });

  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// Get materials for specific batch
router.get('/batches/:id/materials', async (req, res) => {
  try {
    const batchId = req.params.id;

    const batch = await Batch.findByPk(batchId, {
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
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    res.json({
      batch: batch.toJSON(),
      materials: batch.materials || { course_materials: [], session_materials: {} }
    });

  } catch (error) {
    console.error('Get batch materials error:', error);
    res.status(500).json({ error: 'Failed to fetch batch materials' });
  }
});

// Add material to batch
router.post('/batches/:id/materials', [
  body('name').notEmpty().trim().withMessage('Material name is required'),
  body('type').isIn(['document', 'video', 'audio', 'link', 'image']).withMessage('Valid material type is required'),
  body('url').isURL().withMessage('Valid URL is required'),
  body('description').optional(),
  body('session_number').optional().custom((value) => {
    if (value === '' || value === null || value === undefined) return true;
    if (Number.isInteger(Number(value)) && Number(value) >= 1) return true;
    throw new Error('Session number must be a positive integer');
  }),
  body('is_required').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array().map(err => `${err.param}: ${err.msg}`).join(', '),
        validation_errors: errors.array()
      });
    }

    const batchId = req.params.id;
    const { name, type, url, description, session_number, is_required } = req.body;

    const batch = await Batch.findByPk(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const materialData = {
      name: name.trim(),
      type,
      url,
      description: description?.trim() || '',
      is_required: Boolean(is_required)
    };

    let updatedBatch;
    if (session_number && session_number !== '' && session_number !== null) {
      const sessionNum = parseInt(session_number);
      updatedBatch = await batch.addSessionMaterial(sessionNum, materialData, req.user.id);
    } else {
      updatedBatch = await batch.addCourseMaterial(materialData, req.user.id);
    }

    // Include fresh data with all relations
    const freshBatchWithRelations = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' }
      ]
    });

    res.json({
      message: 'Material added successfully',
      batch: {
        ...freshBatchWithRelations.toJSON(),
        materials: updatedBatch.materials
      },
      materials: updatedBatch.materials
    });

  } catch (error) {
    console.error('Add material error:', error);
    res.status(500).json({ 
      error: 'Failed to add material',
      details: error.message
    });
  }
});

// Remove material from batch
router.delete('/batches/:id/materials/:materialId', async (req, res) => {
  try {
    const { id: batchId, materialId } = req.params;
    const { session_number } = req.query;

    const batch = await Batch.findByPk(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const updatedBatch = await batch.removeMaterial(materialId, session_number);

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

// Bulk add materials to multiple batches
router.post('/batches/bulk-materials', [
  body('batch_ids').isArray({ min: 1 }).withMessage('At least one batch must be selected'),
  body('material.name').notEmpty().trim().withMessage('Material name is required'),
  body('material.type').isIn(['document', 'video', 'audio', 'link', 'image']).withMessage('Valid material type is required'),
  body('material.url').isURL().withMessage('Valid URL is required'),
  body('material.description').optional(),
  body('material.session_number').optional().custom((value) => {
    if (value === '' || value === null || value === undefined) return true;
    if (Number.isInteger(Number(value)) && Number(value) >= 1) return true;
    throw new Error('Session number must be a positive integer');
  }),
  body('material.is_required').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Bulk validation errors:', errors.array());
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array().map(err => `${err.param}: ${err.msg}`).join(', '),
        validation_errors: errors.array()
      });
    }

    const { batch_ids, material } = req.body;
    console.log('🔍 Bulk operation:', { batch_ids, material });

    // Verify all batches exist
    const batches = await Batch.findAll({
      where: { id: { [require('sequelize').Op.in]: batch_ids } }
    });

    if (batches.length !== batch_ids.length) {
      return res.status(404).json({ error: 'One or more batches not found' });
    }

    const materialData = {
      name: material.name.trim(),
      type: material.type,
      url: material.url,
      description: material.description?.trim() || '',
      is_required: Boolean(material.is_required)
    };

    console.log('🔍 Processed bulk material data:', materialData);

    const results = [];
    for (const batch of batches) {
      try {
        let updatedBatch;
        if (material.session_number && material.session_number !== '' && material.session_number !== null) {
          const sessionNum = parseInt(material.session_number);
          updatedBatch = await batch.addSessionMaterial(sessionNum, materialData, req.user.id);
        } else {
          updatedBatch = await batch.addCourseMaterial(materialData, req.user.id);
        }
        results.push({
          batch_id: batch.id,
          batch_name: batch.batch_name,
          success: true
        });
      } catch (error) {
        console.error(`❌ Failed to add material to batch ${batch.id}:`, error);
        results.push({
          batch_id: batch.id,
          batch_name: batch.batch_name,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    res.json({
      message: `Material added to ${successCount}/${results.length} batches successfully`,
      results
    });

  } catch (error) {
    console.error('❌ Bulk add materials error:', error);
    res.status(500).json({ 
      error: 'Failed to add materials to batches',
      details: error.message
    });
  }
});

// Get materials overview for admin
router.get('/materials/overview', async (req, res) => {
  try {
    const { course_id, material_type } = req.query;
    
    const whereClause = {};
    if (course_id) whereClause.course_id = course_id;

    const batches = await Batch.findAll({
      where: whereClause,
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' }
      ]
    });

    const overview = batches.map(batch => {
      const materials = batch.materials || { course_materials: [], session_materials: {} };
      
      let courseMaterialsCount = materials.course_materials.length;
      let sessionMaterialsCount = Object.values(materials.session_materials)
        .reduce((sum, sessionMats) => sum + sessionMats.length, 0);

      // Filter by material type if specified
      if (material_type) {
        courseMaterialsCount = materials.course_materials.filter(mat => mat.type === material_type).length;
        sessionMaterialsCount = Object.values(materials.session_materials)
          .reduce((sum, sessionMats) => 
            sum + sessionMats.filter(mat => mat.type === material_type).length, 0);
      }

      return {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        course_name: batch.course.name,
        tutor_name: batch.currentTutor ? 
          `${batch.currentTutor.first_name} ${batch.currentTutor.last_name}` : 'No Tutor',
        course_materials_count: courseMaterialsCount,
        session_materials_count: sessionMaterialsCount,
        total_materials: courseMaterialsCount + sessionMaterialsCount,
        status: batch.status
      };
    });

    res.json(overview);

  } catch (error) {
    console.error('Materials overview error:', error);
    res.status(500).json({ error: 'Failed to fetch materials overview' });
  }
});

// Batch management
router.post('/batches', [
  body('course_id').isUUID(),
  body('start_date').isISO8601(),
  body('schedule').isArray(),
  body('max_students').isInt({ min: 1, max: 20 }),
  body('total_sessions').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { course_id, start_date, schedule, current_tutor_id, max_students, total_sessions } = req.body;

    // Get course details
    const course = await Course.findByPk(course_id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Use provided total_sessions or fall back to course total_sessions
    const sessionCount = total_sessions || course.total_sessions || 8;

    // Generate batch number
    const lastBatch = await Batch.findOne({
      where: { course_id },
      order: [['batch_number', 'DESC']]
    });
    const batch_number = (lastBatch?.batch_number || 0) + 1;

    // Create batch
    const batch = await Batch.create({
      course_id,
      batch_number,
      batch_name: `${course.name} - Batch #${batch_number}`,
      start_date,
      current_tutor_id,
      max_students,
      schedule,
      status: 'Active',
      total_sessions: sessionCount
    });

    // FIXED SESSION CREATION - Handle multiple days per week
    const sessions = [];
const startDate = new Date(start_date);

// Map day names to numbers (Sunday = 0)
const dayMap = {
  'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
  'Thursday': 4, 'Friday': 5, 'Saturday': 6
};

console.log(`Creating ${sessionCount} sessions for schedule:`, schedule);

// Create a list of all session dates first
const sessionDates = [];
let currentDate = new Date(startDate);
let sessionNumber = 1;

// Keep generating dates until we have enough sessions
while (sessionDates.length < sessionCount) {
  // Check each day of the week to see if it matches our schedule
  const currentDayNumber = currentDate.getDay();
  const currentDayName = Object.keys(dayMap).find(day => dayMap[day] === currentDayNumber);
  
  // Check if current day matches any of our scheduled days
  const scheduleMatch = schedule.find(item => item.day === currentDayName);
  
  if (scheduleMatch) {
    // This day matches our schedule, add a session
    const sessionDateTime = new Date(currentDate);
    const [hours, minutes] = scheduleMatch.time.split(':');
    sessionDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    sessionDates.push({
      sessionNumber: sessionNumber++,
      dateTime: new Date(sessionDateTime),
      day: currentDayName
    });
    
    console.log(`Session ${sessionNumber - 1}: ${currentDayName} ${sessionDateTime.toISOString()}`);
  }
  
  // Move to next day
  currentDate.setDate(currentDate.getDate() + 1);
  
  // Safety check to prevent infinite loop
  if (currentDate.getTime() > startDate.getTime() + (365 * 24 * 60 * 60 * 1000)) {
    console.error('Session creation exceeded 1 year, breaking to prevent infinite loop');
    break;
  }
}

// Now create the session objects
sessionDates.forEach(sessionInfo => {
  sessions.push({
    batch_id: batch.id,
    session_number: sessionInfo.sessionNumber,
    curriculum_topic: `Session ${sessionInfo.sessionNumber}`,
    scheduled_datetime: sessionInfo.dateTime,
    assigned_tutor_id: current_tutor_id,
    status: 'Scheduled'
  });
});

console.log(`Created ${sessions.length} sessions total`);

// Bulk create sessions
await Session.bulkCreate(sessions);

    // Return batch with sessions
    const batchWithSessions = await Batch.findByPk(batch.id, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        { model: Session, as: 'sessions', order: [['session_number', 'ASC']] }
      ]
    });

    res.status(201).json(batchWithSessions);
  } catch (error) {
    console.error('Create batch error:', error);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

router.get('/batches', async (req, res) => {
  try {
    const { status, course_id, batch_id } = req.query;
    const where = {};
    
    if (status) where.status = status;
    if (course_id) where.course_id = course_id;
    if (batch_id) where.id = batch_id;

    const batches = await Batch.findAll({
      where,
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        { model: Enrollment, as: 'enrollments', include: [{ model: User, as: 'student' }] }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json(batches);
  } catch (error) {
    console.error('Fetch batches error:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// Update batch
router.put('/batches/:id', [
  body('current_tutor_id').optional().isUUID(),
  body('max_students').optional().isInt({ min: 1, max: 20 }),
  body('total_sessions').optional().isInt({ min: 1, max: 50 }),
  body('schedule').optional().isArray(),
  body('status').optional().isIn(['Active', 'Completed', 'Paused', 'Cancelled']),
  body('start_date').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const batchId = req.params.id;
    const updateData = req.body;

    const [updatedRowsCount] = await Batch.update(updateData, {
      where: { id: batchId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const updatedBatch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        { model: Enrollment, as: 'enrollments', include: [{ model: User, as: 'student' }] }
      ]
    });

    res.json({ 
      message: 'Batch updated successfully', 
      batch: updatedBatch 
    });

  } catch (error) {
    console.error('Update batch error:', error);
    res.status(500).json({ error: 'Failed to update batch' });
  }
});

// Get specific batch details
router.get('/batches/:id', async (req, res) => {
  try {
    const batchId = req.params.id;

    const batch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        {
          model: Enrollment,
          as: 'enrollments',
          include: [{ model: User, as: 'student' }]
        },
        {
          model: Session,
          as: 'sessions',
          include: [{ model: User, as: 'assignedTutor' }],
          order: [['session_number', 'ASC']]
        }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    res.json(batch);
  } catch (error) {
    console.error('Get batch error:', error);
    res.status(500).json({ error: 'Failed to fetch batch' });
  }
});

// Get sessions for specific batch
router.get('/batches/:id/sessions', async (req, res) => {
  try {
    const batchId = req.params.id;

    const batch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        {
          model: Enrollment,
          as: 'enrollments',
          include: [{ model: User, as: 'student' }]
        }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const sessions = await Session.findAll({
      where: { batch_id: batchId },
      include: [
        { model: User, as: 'assignedTutor', attributes: ['id', 'first_name', 'last_name'] }
      ],
      order: [['session_number', 'ASC']]
    });

    // Calculate attendance rates
    const sessionsWithStats = sessions.map(session => {
      const sessionData = session.toJSON();
      
      if (sessionData.attendance) {
        const attendanceEntries = Object.values(sessionData.attendance);
        const totalStudents = attendanceEntries.length;
        const presentCount = attendanceEntries.filter(status => status === 'present').length;
        const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;
        
        sessionData.attendance_stats = {
          present: presentCount,
          total: totalStudents,
          rate: attendanceRate
        };
      } else {
        sessionData.attendance_stats = { present: 0, total: 0, rate: 0 };
      }

      return sessionData;
    });

    res.json({
      batch,
      sessions: sessionsWithStats
    });

  } catch (error) {
    console.error('Get batch sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch batch sessions' });
  }
});

// Sessions Dashboard - FIXED VERSION
router.get('/sessions/dashboard', async (req, res) => {
  try {
    const { filter, date, tutor_id, course_id, status } = req.query;
    
    console.log('Sessions dashboard query params:', req.query); // Debug log
    
    let dateFilter = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (filter) {
      case 'today':
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          scheduled_datetime: {
            [require('sequelize').Op.between]: [today, todayEnd]
          }
        };
        break;

      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          scheduled_datetime: {
            [require('sequelize').Op.between]: [yesterday, yesterdayEnd]
          }
        };
        break;

      case 'tomorrow':
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowEnd = new Date(tomorrow);
        tomorrowEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          scheduled_datetime: {
            [require('sequelize').Op.between]: [tomorrow, tomorrowEnd]
          }
        };
        break;

      case 'week':
        const weekEnd = new Date(today);
        weekEnd.setDate(weekEnd.getDate() + 7);
        dateFilter = {
          scheduled_datetime: {
            [require('sequelize').Op.between]: [today, weekEnd]
          }
        };
        break;

      case 'custom':
        if (date) {
          const customDate = new Date(date);
          const customEnd = new Date(customDate);
          customEnd.setHours(23, 59, 59, 999);
          dateFilter = {
            scheduled_datetime: {
              [require('sequelize').Op.between]: [customDate, customEnd]
            }
          };
        }
        break;

      default:
        // Show all upcoming sessions for default case
        dateFilter = {
          scheduled_datetime: {
            [require('sequelize').Op.gte]: today
          }
        };
    }

    // Build WHERE clause - FIXED to handle empty values properly
    const where = { ...dateFilter };
    
    // Only add filters if they have actual values (not empty strings)
    if (tutor_id && tutor_id.trim() !== '') {
      where.assigned_tutor_id = tutor_id;
    }
    if (status && status.trim() !== '') {
      where.status = status;
    }

    console.log('Final WHERE clause:', where); // Debug log

    // Build include for course filter
    const batchInclude = {
      model: Batch,
      as: 'batch',
      include: [{ model: Course, as: 'course' }]
    };

    // Only add course filter if course_id is provided and not empty
    if (course_id && course_id.trim() !== '') {
      batchInclude.where = { course_id };
    }

    const sessions = await Session.findAll({
      where,
      include: [
        batchInclude,
        { model: User, as: 'assignedTutor', attributes: ['id', 'first_name', 'last_name'] }
      ],
      order: [['scheduled_datetime', 'ASC']]
    });

    console.log(`Found ${sessions.length} sessions`); // Debug log

    // Add attendance stats and alerts
    const sessionsWithAlerts = sessions.map(session => {
      const sessionData = session.toJSON();
      
      // Calculate attendance stats
      if (sessionData.attendance) {
        const attendanceEntries = Object.values(sessionData.attendance);
        const totalStudents = attendanceEntries.length;
        const presentCount = attendanceEntries.filter(status => status === 'present').length;
        const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;
        
        sessionData.attendance_stats = {
          present: presentCount,
          total: totalStudents,
          rate: attendanceRate
        };

        // Generate alerts
        sessionData.alerts = [];
        if (sessionData.status === 'Completed' && attendanceRate < 60) {
          sessionData.alerts.push({
            type: 'low_attendance',
            message: `Low attendance: ${attendanceRate}%`,
            severity: 'warning'
          });
        }
      } else {
        sessionData.attendance_stats = { present: 0, total: 0, rate: 0 };
        sessionData.alerts = [];
      }

      // Check for missing tutor
      if (!sessionData.assigned_tutor_id && sessionData.status === 'Scheduled') {
        sessionData.alerts.push({
          type: 'missing_tutor',
          message: 'No tutor assigned',
          severity: 'error'
        });
      }

      return sessionData;
    });

    res.json(sessionsWithAlerts);

  } catch (error) {
    console.error('Sessions dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions dashboard' });
  }
});

// Get specific session details
router.get('/sessions/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;

    const session = await Session.findByPk(sessionId, {
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Course, as: 'course' },
            { model: User, as: 'currentTutor' },
            {
              model: Enrollment,
              as: 'enrollments',
              include: [{ model: User, as: 'student' }]
            }
          ]
        },
        { model: User, as: 'assignedTutor' }
      ]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error) {
    console.error('Get session details error:', error);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// Update session (general update)
router.put('/sessions/:id', [
  body('status').optional().isIn(['Scheduled', 'Completed', 'Cancelled', 'Rescheduled']),
  body('scheduled_datetime').optional().isISO8601(),
  body('tutor_notes').optional(),
  body('attendance').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.params.id;
    const updateData = req.body;

    const [updatedRowsCount] = await Session.update(updateData, {
      where: { id: sessionId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const updatedSession = await Session.findByPk(sessionId, {
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        },
        { model: User, as: 'assignedTutor' }
      ]
    });

    res.json({
      message: 'Session updated successfully',
      session: updatedSession
    });

  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// FIXED RESCHEDULE LOGIC - Mark original as rescheduled, add new session at end with correct number and date
router.put('/sessions/:id/reschedule', [
  body('new_datetime').optional().isISO8601(), // Made optional for auto-scheduling
  body('reason').optional(),
  body('auto_schedule').optional().isBoolean() // New option for auto-scheduling
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.params.id;
    const { new_datetime, reason, auto_schedule } = req.body;

    // Get the session to reschedule with batch info
    const originalSession = await Session.findByPk(sessionId, {
      include: [{ 
        model: Batch, 
        as: 'batch',
        include: [{ model: Course, as: 'course' }]
      }]
    });

    if (!originalSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const batch = originalSession.batch;

    // Step 1: Mark the original session as "Rescheduled" with reason
    await originalSession.update({
      status: 'Rescheduled',
      tutor_notes: reason || 'Rescheduled by admin'
    });

    // Step 2: Find the CORRECT next session number (highest + 1)
    const maxSessionResult = await Session.findOne({
      where: { batch_id: batch.id },
      order: [['session_number', 'DESC']],
      attributes: ['session_number']
    });

    const newSessionNumber = (maxSessionResult?.session_number || 0) + 1;

    // Step 3: Determine the new session datetime
    let newSessionDateTime;
    
    if (auto_schedule || !new_datetime) {
      // Auto-schedule: Find the last scheduled session and calculate next date
      const lastScheduledSession = await Session.findOne({
        where: { 
          batch_id: batch.id,
          status: { [require('sequelize').Op.ne]: 'Rescheduled' } // Don't count rescheduled sessions
        },
        order: [['scheduled_datetime', 'DESC']]
      });

      if (lastScheduledSession) {
        newSessionDateTime = calculateNextSessionDate(batch, lastScheduledSession.scheduled_datetime);
      } else {
        // Fallback: use batch start date + 7 days
        const startDate = new Date(batch.start_date);
        newSessionDateTime = calculateNextSessionDate(batch, startDate);
      }
    } else {
      // Use provided datetime
      newSessionDateTime = new Date(new_datetime);
    }

    // Step 4: Create NEW session at the end with CORRECT session number
    const newSession = await Session.create({
      batch_id: batch.id,
      session_number: newSessionNumber, // FIXED: Use correct incremented number
      curriculum_topic: originalSession.curriculum_topic || `Session ${newSessionNumber}`,
      scheduled_datetime: newSessionDateTime, // FIXED: Use calculated or provided datetime
      assigned_tutor_id: originalSession.assigned_tutor_id,
      status: 'Scheduled'
    });

    // Step 5: Update batch progress to include the new session
    const totalActiveSessions = await Session.count({
      where: { 
        batch_id: batch.id,
        status: { [require('sequelize').Op.ne]: 'Rescheduled' } // Don't count rescheduled sessions
      }
    });

    const completedSessions = await Session.count({
      where: { 
        batch_id: batch.id,
        status: 'Completed'
      }
    });

    await batch.update({
      progress: {
        ...batch.progress,
        total_sessions: totalActiveSessions,
        current_session: batch.progress?.current_session || 1,
        completed_sessions: completedSessions
      }
    });

    // Return detailed response
    const updatedOriginalSession = await Session.findByPk(sessionId, {
      include: [
        { model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }] },
        { model: User, as: 'assignedTutor' }
      ]
    });

    const createdNewSession = await Session.findByPk(newSession.id, {
      include: [
        { model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }] },
        { model: User, as: 'assignedTutor' }
      ]
    });

    const rescheduledCount = await Session.count({
      where: { batch_id: batch.id, status: 'Rescheduled' }
    });

    res.json({
      message: 'Session rescheduled successfully with new session added at the end',
      original_session: updatedOriginalSession,
      new_session: createdNewSession,
      batch_info: {
        total_active_sessions: totalActiveSessions,
        total_sessions_including_rescheduled: totalActiveSessions + rescheduledCount,
        rescheduled_count: rescheduledCount,
        original_session_number: originalSession.session_number,
        new_session_number: newSessionNumber // FIXED: Now shows correct number
      },
      scheduling_info: {
        auto_scheduled: auto_schedule || !new_datetime,
        new_session_date: newSessionDateTime.toISOString(),
        follows_batch_pattern: auto_schedule || !new_datetime
      }
    });

  } catch (error) {
    console.error('Reschedule session error:', error);
    res.status(500).json({ error: 'Failed to reschedule session' });
  }
});

// Mark attendance for a session
router.post('/sessions/:id/attendance', [
  body('attendance').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.params.id;
    const { attendance } = req.body;

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Update session with attendance and mark as completed
    await session.update({
      attendance,
      status: 'Completed'
    });

    // Calculate attendance statistics
    const attendanceEntries = Object.values(attendance);
    const totalStudents = attendanceEntries.length;
    const presentCount = attendanceEntries.filter(status => status === 'present').length;
    const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

    res.json({
      message: 'Attendance marked successfully',
      session: await Session.findByPk(sessionId, {
        include: [
          { model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }] },
          { model: User, as: 'assignedTutor' }
        ]
      }),
      attendance_stats: {
        total: totalStudents,
        present: presentCount,
        rate: attendanceRate
      }
    });

  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Get alerts
router.get('/alerts', async (req, res) => {
  try {
    const alerts = [];
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. Missing tutors for upcoming sessions
    const sessionsWithoutTutor = await Session.findAll({
      where: {
        assigned_tutor_id: null,
        scheduled_datetime: {
          [require('sequelize').Op.between]: [today, tomorrow]
        },
        status: 'Scheduled'
      },
      include: [{ model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }] }]
    });

    sessionsWithoutTutor.forEach(session => {
      alerts.push({
        type: 'missing_tutor',
        severity: 'error',
        message: `Session ${session.session_number} of ${session.batch.batch_name} has no assigned tutor`,
        session_id: session.id,
        created_at: new Date()
      });
    });

    // 2. Low attendance in recent sessions
    const recentCompletedSessions = await Session.findAll({
      where: {
        status: 'Completed',
        scheduled_datetime: {
          [require('sequelize').Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      },
      include: [{ model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }] }]
    });

    recentCompletedSessions.forEach(session => {
      if (session.attendance) {
        const attendanceEntries = Object.values(session.attendance);
        const totalStudents = attendanceEntries.length;
        const presentCount = attendanceEntries.filter(status => status === 'present').length;
        const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

        if (attendanceRate < 60) {
          alerts.push({
            type: 'low_attendance',
            severity: 'warning',
            message: `Low attendance (${attendanceRate}%) in ${session.batch.batch_name} - Session ${session.session_number}`,
            session_id: session.id,
            created_at: new Date()
          });
        }
      }
    });

    // Sort alerts by severity and date
    alerts.sort((a, b) => {
      const severityOrder = { error: 3, warning: 2, info: 1 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

    res.json(alerts);

  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// User management
router.post('/users', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('first_name').notEmpty().trim(),
  body('last_name').notEmpty().trim(),
  body('role').isIn(['tutor', 'student', 'parent'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userData = {
      ...req.body,
      password_hash: req.body.password
    };
    delete userData.password;

    const user = await User.create(userData);
    const userResponse = user.getSecureView('admin');
    
    res.status(201).json(userResponse);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { role, is_active, search } = req.query;
    const where = {};
    
    if (role) where.role = role;
    if (is_active !== undefined) where.is_active = is_active === 'true';
    
    if (search) {
      where[require('sequelize').Op.or] = [
        { first_name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { last_name: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { email: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }

    const users = await User.findAll({
      where,
      order: [['created_at', 'DESC']]
    });

    const usersResponse = users.map(user => user.getSecureView('admin'));
    res.json(usersResponse);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.put('/users/:id', [
  body('first_name').optional().notEmpty().trim(),
  body('last_name').optional().notEmpty().trim(),
  body('role').optional().isIn(['tutor', 'student', 'parent']),
  body('phone').optional(),
  body('timezone').optional(),
  body('is_active').optional().isBoolean(),
  body('password').optional().isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.params.id;
    const updateData = req.body;

    if (updateData.password) {
      updateData.password_hash = updateData.password;
      delete updateData.password;
    }

    const [updatedRowsCount] = await User.update(updateData, {
      where: { id: userId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = await User.findByPk(userId);
    const userResponse = updatedUser.getSecureView('admin');

    res.json({ 
      message: 'User updated successfully', 
      user: userResponse 
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    const [updatedRowsCount] = await User.update(
      { is_active: false },
      { where: { id: userId } }
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deactivated successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});
// ===== ADD THESE ENDPOINTS TO YOUR BACKEND admin.js ROUTES FILE =====

// BATCH MEET LINK MANAGEMENT
router.put('/batches/:id/gmeet-link', [
  body('gmeet_link').optional().custom((value) => {
    if (value && !value.includes('meet.google.com')) {
      throw new Error('Must be a valid Google Meet URL');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const batchId = req.params.id;
    const { gmeet_link } = req.body;

    const [updatedRowsCount] = await Batch.update(
      { gmeet_link },
      { where: { id: batchId } }
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const updatedBatch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' }
      ]
    });

    res.json({
      message: 'Google Meet link updated successfully',
      batch: updatedBatch
    });

  } catch (error) {
    console.error('Update meet link error:', error);
    res.status(500).json({ error: 'Failed to update meet link' });
  }
});

// BATCH STATUS MANAGEMENT
router.put('/batches/:id/status', [
  body('status').isIn(['Active', 'Completed', 'Paused', 'Cancelled'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const batchId = req.params.id;
    const { status, reason } = req.body;

    const batch = await Batch.findByPk(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Update batch status
    await batch.update({ status });

    // If completing batch, mark future sessions as completed
    if (status === 'Completed') {
      await Session.update(
        { status: 'Completed' },
        {
          where: {
            batch_id: batchId,
            status: 'Scheduled',
            scheduled_datetime: { [require('sequelize').Op.gt]: new Date() }
          }
        }
      );
    }

    const updatedBatch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        { model: Enrollment, as: 'enrollments', include: [{ model: User, as: 'student' }] }
      ]
    });

    res.json({
      message: `Batch status updated to ${status}`,
      batch: updatedBatch
    });

  } catch (error) {
    console.error('Update batch status error:', error);
    res.status(500).json({ error: 'Failed to update batch status' });
  }
});

// BATCH REACTIVATION
router.put('/batches/:id/reactivate', [
  body('resume_from_session').isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const batchId = req.params.id;
    const { resume_from_session } = req.body;

    const batch = await Batch.findByPk(batchId, {
      include: [{ model: Session, as: 'sessions' }]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status !== 'Completed') {
      return res.status(400).json({ error: 'Only completed batches can be reactivated' });
    }

    // Update batch status to Active
    await batch.update({ status: 'Active' });

    // Mark sessions from resume_from_session onwards as Scheduled
    await Session.update(
      { status: 'Scheduled' },
      {
        where: {
          batch_id: batchId,
          session_number: { [require('sequelize').Op.gte]: resume_from_session }
        }
      }
    );

    const updatedBatch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        { model: Session, as: 'sessions', order: [['session_number', 'ASC']] }
      ]
    });

    res.json({
      message: `Batch reactivated from session ${resume_from_session}`,
      batch: updatedBatch,
      reactivated_sessions: updatedBatch.sessions.filter(s => s.session_number >= resume_from_session).length
    });

  } catch (error) {
    console.error('Batch reactivation error:', error);
    res.status(500).json({ error: 'Failed to reactivate batch' });
  }
});

// ENHANCED BATCH SEARCH
router.get('/batches/search', async (req, res) => {
  try {
    const { 
      q,           // general search term
      course_id,   // course filter
      tutor_id,    // tutor filter
      status,      // status filter
      date_from,   // start date filter
      date_to,     // end date filter
      students_min, // minimum students
      students_max, // maximum students
      sort_by,     // sort field
      sort_order   // asc/desc
    } = req.query;

    let where = {};
    let include = [
      { model: Course, as: 'course' },
      { model: User, as: 'currentTutor' },
      { 
        model: Enrollment, 
        as: 'enrollments',
        include: [{ model: User, as: 'student' }]
      }
    ];

    // Apply filters
    if (course_id) where.course_id = course_id;
    if (tutor_id) where.current_tutor_id = tutor_id;
    if (status) where.status = status;
    if (date_from) where.start_date = { [require('sequelize').Op.gte]: date_from };
    if (date_to) {
      where.start_date = {
        ...where.start_date,
        [require('sequelize').Op.lte]: date_to
      };
    }

    // General search across batch name, course name, tutor name
    if (q) {
      where[require('sequelize').Op.or] = [
        { batch_name: { [require('sequelize').Op.iLike]: `%${q}%` } }
      ];
    }

    let order = [['created_at', 'DESC']];
    if (sort_by) {
      const sortOrder = sort_order === 'asc' ? 'ASC' : 'DESC';
      switch (sort_by) {
        case 'batch_name':
          order = [['batch_name', sortOrder]];
          break;
        case 'start_date':
          order = [['start_date', sortOrder]];
          break;
        case 'course_name':
          order = [[{ model: Course, as: 'course' }, 'name', sortOrder]];
          break;
        default:
          order = [['created_at', sortOrder]];
      }
    }

    let batches = await Batch.findAll({
      where,
      include,
      order
    });

    // Post-process filters that require JS logic
    if (students_min || students_max) {
      batches = batches.filter(batch => {
        const studentCount = batch.enrollments?.length || 0;
        if (students_min && studentCount < parseInt(students_min)) return false;
        if (students_max && studentCount > parseInt(students_max)) return false;
        return true;
      });
    }

    // Filter by general search term in related models
    if (q) {
      const searchTerm = q.toLowerCase();
      batches = batches.filter(batch => {
        return (
          batch.batch_name.toLowerCase().includes(searchTerm) ||
          batch.course?.name.toLowerCase().includes(searchTerm) ||
          `${batch.currentTutor?.first_name} ${batch.currentTutor?.last_name}`.toLowerCase().includes(searchTerm)
        );
      });
    }

    res.json(batches);

  } catch (error) {
    console.error('Batch search error:', error);
    res.status(500).json({ error: 'Failed to search batches' });
  }
});

// ENHANCED USER SEARCH
router.get('/users/search', async (req, res) => {
  try {
    const { 
      q,           // general search term
      role,        // role filter
      status,      // active/inactive
      date_from,   // registration date from
      date_to,     // registration date to
      sort_by,     // sort field
      sort_order   // asc/desc
    } = req.query;

    let where = {};

    // Apply filters
    if (role) where.role = role;
    if (status === 'active') where.is_active = true;
    if (status === 'inactive') where.is_active = false;
    if (date_from) where.created_at = { [require('sequelize').Op.gte]: date_from };
    if (date_to) {
      where.created_at = {
        ...where.created_at,
        [require('sequelize').Op.lte]: date_to
      };
    }

    // General search across name, email, phone
    if (q) {
      where[require('sequelize').Op.or] = [
        { first_name: { [require('sequelize').Op.iLike]: `%${q}%` } },
        { last_name: { [require('sequelize').Op.iLike]: `%${q}%` } },
        { email: { [require('sequelize').Op.iLike]: `%${q}%` } },
        { phone: { [require('sequelize').Op.iLike]: `%${q}%` } }
      ];
    }

    let order = [['created_at', 'DESC']];
    if (sort_by) {
      const sortOrder = sort_order === 'asc' ? 'ASC' : 'DESC';
      switch (sort_by) {
        case 'name':
          order = [['first_name', sortOrder], ['last_name', sortOrder]];
          break;
        case 'email':
          order = [['email', sortOrder]];
          break;
        case 'role':
          order = [['role', sortOrder]];
          break;
        default:
          order = [['created_at', sortOrder]];
      }
    }

    const users = await User.findAll({
      where,
      order
    });

    // Return role-appropriate user data
    const usersResponse = users.map(user => user.getSecureView('admin'));
    res.json(usersResponse);

  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// INDIVIDUAL SESSION EDITING
router.put('/sessions/:id/details', [
  body('scheduled_datetime').optional().isISO8601(),
  body('curriculum_topic').optional(),
  body('assigned_tutor_id').optional().isUUID(),
  body('tutor_notes').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.params.id;
    const updateData = req.body;

    // Validate business hours if datetime is being updated
    if (updateData.scheduled_datetime) {
      const sessionDate = new Date(updateData.scheduled_datetime);
      const hour = sessionDate.getHours();
      
      if (hour < 9 || hour > 21) {
        return res.status(400).json({ 
          error: 'Sessions must be scheduled between 9 AM and 9 PM' 
        });
      }

      // Check for tutor conflicts if tutor is assigned
      if (updateData.assigned_tutor_id) {
        const conflict = await Session.findOne({
          where: {
            assigned_tutor_id: updateData.assigned_tutor_id,
            scheduled_datetime: {
              [require('sequelize').Op.between]: [
                new Date(sessionDate.getTime() - 30 * 60 * 1000), // 30 min before
                new Date(sessionDate.getTime() + 90 * 60 * 1000)  // 90 min after
              ]
            },
            status: ['Scheduled', 'Completed'],
            id: { [require('sequelize').Op.ne]: sessionId }
          }
        });

        if (conflict) {
          return res.status(409).json({ 
            error: 'Tutor has a conflicting session at this time' 
          });
        }
      }
    }

    const [updatedRowsCount] = await Session.update(updateData, {
      where: { id: sessionId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const updatedSession = await Session.findByPk(sessionId, {
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        },
        { model: User, as: 'assignedTutor' }
      ]
    });

    res.json({
      message: 'Session updated successfully',
      session: updatedSession
    });

  } catch (error) {
    console.error('Update session details error:', error);
    res.status(500).json({ error: 'Failed to update session details' });
  }
});

// BULK SESSION OPERATIONS
router.post('/sessions/bulk-update', [
  body('session_ids').isArray({ min: 1 }),
  body('update_data').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { session_ids, update_data } = req.body;

    // Validate that all sessions exist
    const sessions = await Session.findAll({
      where: { id: { [require('sequelize').Op.in]: session_ids } }
    });

    if (sessions.length !== session_ids.length) {
      return res.status(404).json({ error: 'One or more sessions not found' });
    }

    // Perform bulk update
    const [updatedRowsCount] = await Session.update(update_data, {
      where: { id: { [require('sequelize').Op.in]: session_ids } }
    });

    res.json({
      message: `${updatedRowsCount} sessions updated successfully`,
      updated_count: updatedRowsCount
    });

  } catch (error) {
    console.error('Bulk session update error:', error);
    res.status(500).json({ error: 'Failed to update sessions' });
  }
});

// BULK BATCH OPERATIONS
router.post('/batches/bulk-update', [
  body('batch_ids').isArray({ min: 1 }),
  body('update_data').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { batch_ids, update_data } = req.body;

    // Validate that all batches exist
    const batches = await Batch.findAll({
      where: { id: { [require('sequelize').Op.in]: batch_ids } }
    });

    if (batches.length !== batch_ids.length) {
      return res.status(404).json({ error: 'One or more batches not found' });
    }

    // Perform bulk update
    const [updatedRowsCount] = await Batch.update(update_data, {
      where: { id: { [require('sequelize').Op.in]: batch_ids } }
    });

    res.json({
      message: `${updatedRowsCount} batches updated successfully`,
      updated_count: updatedRowsCount
    });

  } catch (error) {
    console.error('Bulk batch update error:', error);
    res.status(500).json({ error: 'Failed to update batches' });
  }
});

// CALENDAR VIEW
router.get('/calendar', async (req, res) => {
  try {
    const { start_date, end_date, tutor_id, course_id } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    let where = {
      scheduled_datetime: {
        [require('sequelize').Op.between]: [start_date, end_date]
      }
    };

    let include = [
      {
        model: Batch,
        as: 'batch',
        include: [{ model: Course, as: 'course' }]
      },
      { model: User, as: 'assignedTutor' }
    ];

    // Apply filters
    if (tutor_id) where.assigned_tutor_id = tutor_id;
    if (course_id) {
      include[0].where = { course_id };
    }

    const sessions = await Session.findAll({
      where,
      include,
      order: [['scheduled_datetime', 'ASC']]
    });

    // Format for calendar view
    const calendarEvents = sessions.map(session => ({
      id: session.id,
      title: `${session.batch.batch_name} - Session ${session.session_number}`,
      start: session.scheduled_datetime,
      end: new Date(new Date(session.scheduled_datetime).getTime() + 60 * 60 * 1000), // +1 hour
      status: session.status,
      tutor: session.assignedTutor ? `${session.assignedTutor.first_name} ${session.assignedTutor.last_name}` : 'No Tutor',
      course: session.batch.course.name,
      batch_id: session.batch_id,
      session_number: session.session_number
    }));

    res.json(calendarEvents);

  } catch (error) {
    console.error('Calendar view error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

// TUTOR CONFLICT CHECK
router.get('/tutors/conflicts', async (req, res) => {
  try {
    const { tutor_id, datetime, exclude_session } = req.query;

    if (!tutor_id || !datetime) {
      return res.status(400).json({ error: 'Tutor ID and datetime are required' });
    }

    const checkDate = new Date(datetime);
    let where = {
      assigned_tutor_id: tutor_id,
      scheduled_datetime: {
        [require('sequelize').Op.between]: [
          new Date(checkDate.getTime() - 30 * 60 * 1000), // 30 min before
          new Date(checkDate.getTime() + 90 * 60 * 1000)  // 90 min after
        ]
      },
      status: ['Scheduled', 'Completed']
    };

    if (exclude_session) {
      where.id = { [require('sequelize').Op.ne]: exclude_session };
    }

    const conflicts = await Session.findAll({
      where,
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [{ model: Course, as: 'course' }]
        }
      ]
    });

    res.json({
      has_conflicts: conflicts.length > 0,
      conflicts: conflicts.map(session => ({
        session_id: session.id,
        session_number: session.session_number,
        batch_name: session.batch.batch_name,
        course_name: session.batch.course.name,
        scheduled_datetime: session.scheduled_datetime,
        status: session.status
      }))
    });

  } catch (error) {
    console.error('Conflict check error:', error);
    res.status(500).json({ error: 'Failed to check conflicts' });
  }
});

// EXPORT BATCH DATA
router.get('/batches/:id/export', async (req, res) => {
  try {
    const batchId = req.params.id;
    const { format = 'csv' } = req.query;

    const batch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        {
          model: Enrollment,
          as: 'enrollments',
          include: [{ model: User, as: 'student' }]
        },
        {
          model: Session,
          as: 'sessions',
          include: [{ model: User, as: 'assignedTutor' }],
          order: [['session_number', 'ASC']]
        }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (format === 'json') {
      res.json(batch);
    } else {
      // CSV format
      let csvContent = 'Batch Name,Course,Tutor,Student Count,Session Count,Status,Start Date\n';
      csvContent += `"${batch.batch_name}","${batch.course.name}","${batch.currentTutor ? batch.currentTutor.first_name + ' ' + batch.currentTutor.last_name : 'No Tutor'}",${batch.enrollments.length},${batch.sessions.length},"${batch.status}","${batch.start_date}"\n\n`;
      
      csvContent += 'Sessions:\n';
      csvContent += 'Session Number,Topic,Date,Time,Tutor,Status\n';
      
      batch.sessions.forEach(session => {
        const sessionDate = new Date(session.scheduled_datetime);
        csvContent += `${session.session_number},"${session.curriculum_topic || 'No Topic'}","${sessionDate.toLocaleDateString()}","${sessionDate.toLocaleTimeString()}","${session.assignedTutor ? session.assignedTutor.first_name + ' ' + session.assignedTutor.last_name : 'No Tutor'}","${session.status}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${batch.batch_name}_export.csv"`);
      res.send(csvContent);
    }

  } catch (error) {
    console.error('Export batch error:', error);
    res.status(500).json({ error: 'Failed to export batch data' });
  }
});
module.exports = router;
