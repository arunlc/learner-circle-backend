const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, Course, Batch, Session, Enrollment } = require('../models');
const { authMiddleware, roleGuard } = require('../middleware/auth');

const router = express.Router();

// Apply auth middleware and admin role guard to all routes
router.use(authMiddleware);
router.use(roleGuard(['admin']));

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

    let sessionNumber = 1;
    let currentWeek = 0;
    const maxWeeks = Math.ceil(sessionCount / schedule.length);

    console.log(`Creating ${sessionCount} sessions across ${schedule.length} days per week for ${maxWeeks} weeks`);

    while (sessionNumber <= sessionCount && currentWeek < maxWeeks) {
      // For each week, create sessions for each scheduled day
      for (const scheduleItem of schedule) {
        if (sessionNumber > sessionCount) break;

        const dayNumber = dayMap[scheduleItem.day];
        const [hours, minutes] = scheduleItem.time.split(':');

        // Calculate the date for this session
        const sessionDate = new Date(startDate);
        
        // Move to the start of the current week
        const startOfWeek = new Date(startDate);
        startOfWeek.setDate(startDate.getDate() + (currentWeek * 7));
        
        // Find the next occurrence of the target day
        const daysToAdd = (dayNumber - startOfWeek.getDay() + 7) % 7;
        sessionDate.setDate(startOfWeek.getDate() + daysToAdd);
        
        // Set the time
        sessionDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        // Only create session if it's on or after the start date
        if (sessionDate >= startDate) {
          sessions.push({
            batch_id: batch.id,
            session_number: sessionNumber,
            curriculum_topic: `Session ${sessionNumber}`,
            scheduled_datetime: sessionDate,
            assigned_tutor_id: current_tutor_id,
            status: 'Scheduled'
          });

          console.log(`Session ${sessionNumber}: ${scheduleItem.day} ${sessionDate.toISOString()}`);
          sessionNumber++;
        }
      }
      currentWeek++;
    }

    console.log(`Created ${sessions.length} sessions`);

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

// Sessions Dashboard
// QUICK FIX: Update this section in your routes/admin.js file
// Replace the Sessions Dashboard route (around line 400-450) with this:

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

// SESSION MANAGEMENT ROUTES (NEW)

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

// Reschedule session with cascade effect
router.put('/sessions/:id/reschedule', [
  body('new_datetime').isISO8601(),
  body('reason').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.params.id;
    const { new_datetime, reason } = req.body;

    // Get the session to reschedule
    const session = await Session.findByPk(sessionId, {
      include: [{ model: Batch, as: 'batch' }]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const originalDateTime = new Date(session.scheduled_datetime);
    const newDateTime = new Date(new_datetime);
    const timeDifference = newDateTime.getTime() - originalDateTime.getTime();

    // Update the current session
    await session.update({
      scheduled_datetime: new_datetime,
      status: 'Rescheduled',
      tutor_notes: reason || 'Rescheduled by admin'
    });

    // Cascade reschedule: Update all subsequent sessions in the same batch
    let cascadedSessions = [];
    if (timeDifference !== 0) {
      const subsequentSessions = await Session.findAll({
        where: {
          batch_id: session.batch_id,
          session_number: { [require('sequelize').Op.gt]: session.session_number },
          status: 'Scheduled'
        }
      });

      for (const subsequentSession of subsequentSessions) {
        const currentDateTime = new Date(subsequentSession.scheduled_datetime);
        const newSubsequentDateTime = new Date(currentDateTime.getTime() + timeDifference);
        
        await subsequentSession.update({
          scheduled_datetime: newSubsequentDateTime
        });
      }
      cascadedSessions = subsequentSessions;
    }

    res.json({
      message: 'Session rescheduled successfully with cascade updates',
      session: await Session.findByPk(sessionId, {
        include: [
          { model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }] },
          { model: User, as: 'assignedTutor' }
        ]
      }),
      cascaded_sessions: cascadedSessions?.length || 0
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

module.exports = router;
