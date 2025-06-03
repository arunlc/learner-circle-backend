const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, Course, Batch, Session, Enrollment } = require('../models');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const GoogleMeetService = require('../services/googleMeet');
const SchedulingService = require('../services/scheduling');

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

// Course management
router.post('/courses', [
  body('name').notEmpty().trim(),
  body('skill_level').isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('total_sessions').isInt({ min: 1 }),
  body('curriculum').isArray()
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

router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.findAll({
      where: { is_active: true },
      include: [{
        model: Batch,
        as: 'batches',
        where: { status: 'Active' },
        required: false
      }]
    });
    res.json(courses);
  } catch (error) {
    console.error('Fetch courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Batch management
router.post('/batches', [
  body('course_id').isUUID(),
  body('start_date').isISO8601(),
  body('schedule').isArray(),
  body('max_students').isInt({ min: 1, max: 20 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { course_id, start_date, schedule, current_tutor_id, max_students } = req.body;

    // Get course details
    const course = await Course.findByPk(course_id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

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
      status: 'Active'
    });

    // Generate sessions using scheduling service
    const schedulingService = new SchedulingService();
    const sessions = await schedulingService.generateBatchSessions({
      batch_id: batch.id,
      course_id,
      start_date,
      session_count: course.total_sessions,
      schedule,
      tutor_id: current_tutor_id,
      curriculum: course.curriculum
    });

    // Create Google Meet links for sessions
    const googleMeetService = new GoogleMeetService();
    for (const sessionData of sessions) {
      const meetingData = await googleMeetService.createSessionMeeting(sessionData, batch);
      sessionData.gmeet_link = meetingData.meet_link;
      sessionData.gmeet_meeting_id = meetingData.meeting_id;
    }

    // Bulk create sessions
    await Session.bulkCreate(sessions);

    // Return batch with sessions
    const batchWithSessions = await Batch.findByPk(batch.id, {
      include: [
        { model: Course, as: 'course' },
        { model: User, as: 'currentTutor' },
        { model: Session, as: 'sessions' }
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
    const { status, course_id } = req.query;
    const where = {};
    
    if (status) where.status = status;
    if (course_id) where.course_id = course_id;

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
    const { role, is_active } = req.query;
    const where = {};
    
    if (role) where.role = role;
    if (is_active !== undefined) where.is_active = is_active === 'true';

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

module.exports = router;
