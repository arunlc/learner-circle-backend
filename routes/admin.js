const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, Course, Batch, Session, Enrollment } = require('../models');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const { GoogleMeetService, SchedulingService } = require('../services/googleWorkspace');

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
  body('total_sessions').isInt({ min: 1 }),  // BACK TO total_sessions
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

router.put('/courses/:id', [
  body('name').optional().notEmpty().trim(),
  body('skill_level').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
  body('total_sessions').optional().isInt({ min: 1 }),  // BACK TO total_sessions
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

    // Update course
    const [updatedRowsCount] = await Course.update(updateData, {
      where: { id: courseId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Get updated course
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

// Delete course (soft delete)
router.delete('/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;

    // Check if course has active batches
    const activeBatches = await Batch.count({
      where: { 
        course_id: courseId,
        status: ['Active', 'Paused']
      }
    });

    if (activeBatches > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete course with active batches. Please complete or cancel all batches first.' 
      });
    }

    // Soft delete - set course as inactive
    const [updatedRowsCount] = await Course.update(
      { is_active: false },
      { where: { id: courseId } }
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ message: 'Course deleted successfully' });

  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
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

    // Use provided total_sessions or fall back to course suggested_sessions
    const sessionCount = total_sessions || course.suggested_sessions || 8;

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

    // Generate sessions using scheduling service
    const schedulingService = new SchedulingService();
    const sessions = await schedulingService.generateBatchSessions({
      batch_id: batch.id,
      course_id,
      start_date,
      session_count: sessionCount,
      schedule,
      tutor_id: current_tutor_id,
      curriculum: course.curriculum
    });

    // Create Google Meet links for sessions
    const googleMeetService = new GoogleMeetService();
    for (const sessionData of sessions) {
      try {
        const meetingData = await googleMeetService.createSessionMeeting(sessionData, batch);
        sessionData.gmeet_link = meetingData.meet_link;
        sessionData.gmeet_meeting_id = meetingData.meeting_id;
      } catch (error) {
        console.error('Google Meet creation failed for session:', sessionData.session_number, error);
        // Continue without meet link for now
      }
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

    // Update batch
    const [updatedRowsCount] = await Batch.update(updateData, {
      where: { id: batchId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Get updated batch with relationships
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

// Delete batch (soft delete)
router.delete('/batches/:id', async (req, res) => {
  try {
    const batchId = req.params.id;

    // Check if batch has active sessions today or in future
    const activeSessions = await Session.count({
      where: {
        batch_id: batchId,
        scheduled_datetime: {
          [require('sequelize').Op.gte]: new Date()
        },
        status: 'Scheduled'
      }
    });

    if (activeSessions > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete batch with upcoming sessions. Please cancel sessions first.' 
      });
    }

    // Update batch status to cancelled
    const [updatedRowsCount] = await Batch.update(
      { status: 'Cancelled' },
      { where: { id: batchId } }
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    res.json({ message: 'Batch cancelled successfully' });

  } catch (error) {
    console.error('Delete batch error:', error);
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

// BATCH ENROLLMENT MANAGEMENT

// Get batch enrollments
router.get('/batches/:id/enrollments', async (req, res) => {
  try {
    const batchId = req.params.id;

    const batch = await Batch.findByPk(batchId, {
      include: [
        { model: Course, as: 'course' },
        { 
          model: Enrollment, 
          as: 'enrollments',
          include: [{ 
            model: User, 
            as: 'student',
            where: { role: 'student' }
          }]
        }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Filter student contact information for consistency
    const enrollmentsResponse = batch.enrollments.map(enrollment => ({
      ...enrollment.toJSON(),
      student: enrollment.student ? enrollment.student.getSecureView('admin') : null
    }));

    res.json({
      batch: {
        id: batch.id,
        batch_name: batch.batch_name,
        course: batch.course,
        max_students: batch.max_students
      },
      enrollments: enrollmentsResponse
    });

  } catch (error) {
    console.error('Get batch enrollments error:', error);
    res.status(500).json({ error: 'Failed to fetch batch enrollments' });
  }
});

// Add student to batch
router.post('/batches/:id/enrollments', [
  body('student_id').isUUID(),
  body('payment_status').optional().isIn(['Paid', 'Pending', 'Partial', 'Refunded'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const batchId = req.params.id;
    const { student_id, payment_status = 'Pending' } = req.body;

    // Check if batch exists and has space
    const batch = await Batch.findByPk(batchId, {
      include: [{ model: Enrollment, as: 'enrollments', where: { status: 'Active' }, required: false }]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status !== 'Active') {
      return res.status(400).json({ error: 'Cannot enroll in non-active batch' });
    }

    const currentEnrollments = batch.enrollments?.length || 0;
    if (currentEnrollments >= batch.max_students) {
      return res.status(400).json({ error: 'Batch is full' });
    }

    // Check if student exists and is active
    const student = await User.findOne({
      where: { id: student_id, role: 'student', is_active: true }
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    // Check if student is already enrolled in this batch
    const existingEnrollment = await Enrollment.findOne({
      where: { batch_id: batchId, student_id, status: 'Active' }
    });

    if (existingEnrollment) {
      return res.status(400).json({ error: 'Student is already enrolled in this batch' });
    }

    // Create enrollment
    const enrollment = await Enrollment.create({
      batch_id: batchId,
      student_id,
      payment_status,
      status: 'Active'
    });

    // Return enrollment with student info
    const enrollmentWithStudent = await Enrollment.findByPk(enrollment.id, {
      include: [{ model: User, as: 'student' }]
    });

    res.status(201).json({
      message: 'Student enrolled successfully',
      enrollment: {
        ...enrollmentWithStudent.toJSON(),
        student: enrollmentWithStudent.student.getSecureView('admin')
      }
    });

  } catch (error) {
    console.error('Add enrollment error:', error);
    res.status(500).json({ error: 'Failed to enroll student' });
  }
});

// Remove student from batch
router.delete('/batches/:batchId/enrollments/:enrollmentId', async (req, res) => {
  try {
    const { batchId, enrollmentId } = req.params;

    const enrollment = await Enrollment.findOne({
      where: { id: enrollmentId, batch_id: batchId }
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Update enrollment status to 'Dropped' instead of hard delete
    await enrollment.update({ status: 'Dropped' });

    res.json({ message: 'Student removed from batch successfully' });

  } catch (error) {
    console.error('Remove enrollment error:', error);
    res.status(500).json({ error: 'Failed to remove student from batch' });
  }
});

// Update enrollment (payment status, etc.)
router.put('/batches/:batchId/enrollments/:enrollmentId', [
  body('payment_status').optional().isIn(['Paid', 'Pending', 'Partial', 'Refunded']),
  body('status').optional().isIn(['Active', 'Completed', 'Dropped', 'Transferred'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { batchId, enrollmentId } = req.params;
    const updateData = req.body;

    const [updatedRowsCount] = await Enrollment.update(updateData, {
      where: { id: enrollmentId, batch_id: batchId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    const updatedEnrollment = await Enrollment.findByPk(enrollmentId, {
      include: [{ model: User, as: 'student' }]
    });

    res.json({
      message: 'Enrollment updated successfully',
      enrollment: {
        ...updatedEnrollment.toJSON(),
        student: updatedEnrollment.student.getSecureView('admin')
      }
    });

  } catch (error) {
    console.error('Update enrollment error:', error);
    res.status(500).json({ error: 'Failed to update enrollment' });
  }
});

// Get available students for batch enrollment
router.get('/students/available', async (req, res) => {
  try {
    const { batch_id } = req.query;

    // Get students who are not enrolled in this batch
    let whereClause = { role: 'student', is_active: true };

    if (batch_id) {
      // Get students already enrolled in this batch
      const enrolledStudents = await Enrollment.findAll({
        where: { batch_id, status: 'Active' },
        attributes: ['student_id']
      });
      
      const enrolledStudentIds = enrolledStudents.map(e => e.student_id);
      
      if (enrolledStudentIds.length > 0) {
        whereClause.id = { [require('sequelize').Op.notIn]: enrolledStudentIds };
      }
    }

    const availableStudents = await User.findAll({
      where: whereClause,
      attributes: ['id', 'first_name', 'last_name', 'email', 'created_at'],
      order: [['first_name', 'ASC']]
    });

    res.json(availableStudents);

  } catch (error) {
    console.error('Get available students error:', error);
    res.status(500).json({ error: 'Failed to fetch available students' });
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
    
    // Add search functionality
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

    // Hash password if provided
    if (updateData.password) {
      updateData.password_hash = updateData.password;
      delete updateData.password;
    }

    // Update user
    const [updatedRowsCount] = await User.update(updateData, {
      where: { id: userId }
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get updated user
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

// Delete user (soft delete - set inactive)
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    // Soft delete - set user as inactive
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

// BULK OPERATIONS

// Bulk user operations
router.post('/users/bulk', [
  body('action').isIn(['activate', 'deactivate', 'delete']),
  body('user_ids').isArray().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { action, user_ids } = req.body;

    let updateData = {};
    switch (action) {
      case 'activate':
        updateData = { is_active: true };
        break;
      case 'deactivate':
        updateData = { is_active: false };
        break;
      case 'delete':
        updateData = { is_active: false };
        break;
    }

    const [updatedCount] = await User.update(updateData, {
      where: { id: user_ids }
    });

    res.json({
      message: `Successfully ${action}d ${updatedCount} users`,
      updated_count: updatedCount
    });

  } catch (error) {
    console.error('Bulk user operation error:', error);
    res.status(500).json({ error: 'Failed to perform bulk operation' });
  }
});

// SESSION MONITORING

// Get all sessions with filtering
router.get('/sessions', async (req, res) => {
  try {
    const { date, status, tutor_id, batch_id } = req.query;
    const where = {};

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      
      where.scheduled_datetime = {
        [require('sequelize').Op.between]: [startDate, endDate]
      };
    }

    if (status) where.status = status;
    if (tutor_id) where.assigned_tutor_id = tutor_id;
    if (batch_id) where.batch_id = batch_id;

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
        },
        { model: User, as: 'assignedTutor' }
      ],
      order: [['scheduled_datetime', 'ASC']]
    });

    // Filter contact information
    const sessionsResponse = sessions.map(session => {
      const sessionData = session.toJSON();
      
      if (sessionData.batch?.enrollments) {
        sessionData.batch.enrollments = sessionData.batch.enrollments.map(enrollment => ({
          ...enrollment,
          student: enrollment.student ? enrollment.student.getSecureView('admin') : null
        }));
      }

      if (sessionData.assignedTutor) {
        sessionData.assignedTutor = sessionData.assignedTutor.getSecureView('admin');
      }

      return sessionData;
    });

    res.json(sessionsResponse);

  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Reschedule session
router.put('/sessions/:id/reschedule', [
  body('new_datetime').isISO8601(),
  body('reason').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sessionId = req.params.id;
    const { new_datetime, reason } = req.body;

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if new time conflicts with tutor's other sessions
    const conflictSession = await Session.findOne({
      where: {
        assigned_tutor_id: session.assigned_tutor_id,
        scheduled_datetime: {
          [require('sequelize').Op.between]: [
            new Date(new Date(new_datetime).getTime() - 30 * 60 * 1000), // 30 min before
            new Date(new Date(new_datetime).getTime() + 90 * 60 * 1000)  // 90 min after
          ]
        },
        status: 'Scheduled',
        id: { [require('sequelize').Op.ne]: sessionId }
      }
    });

    if (conflictSession) {
      return res.status(400).json({ error: 'Time conflict with another session' });
    }

    // Update session
    await session.update({
      scheduled_datetime: new_datetime,
      status: 'Rescheduled',
      tutor_notes: session.tutor_notes ? 
        `${session.tutor_notes}\n\nRescheduled: ${reason || 'No reason provided'}` :
        `Rescheduled: ${reason || 'No reason provided'}`
    });

    // TODO: Update Google Calendar event here
    // const googleMeetService = new GoogleMeetService();
    // await googleMeetService.updateSessionMeeting(session.gmeet_meeting_id, {
    //   start: { dateTime: new_datetime },
    //   end: { dateTime: new Date(new Date(new_datetime).getTime() + 60 * 60 * 1000) }
    // });

    res.json({ message: 'Session rescheduled successfully', session });

  } catch (error) {
    console.error('Reschedule session error:', error);
    res.status(500).json({ error: 'Failed to reschedule session' });
  }
});

// Cancel session
router.put('/sessions/:id/cancel', [
  body('reason').optional().isString()
], async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { reason } = req.body;

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'Completed') {
      return res.status(400).json({ error: 'Cannot cancel completed session' });
    }

    // Update session status
    await session.update({
      status: 'Cancelled',
      tutor_notes: session.tutor_notes ? 
        `${session.tutor_notes}\n\nCancelled: ${reason || 'No reason provided'}` :
        `Cancelled: ${reason || 'No reason provided'}`
    });

    res.json({ message: 'Session cancelled successfully', session });

  } catch (error) {
    console.error('Cancel session error:', error);
    res.status(500).json({ error: 'Failed to cancel session' });
  }
});

// ANALYTICS AND REPORTS

// Get analytics data
router.get('/analytics', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    // Date range filter
    let dateFilter = {};
    if (start_date && end_date) {
      dateFilter = {
        scheduled_datetime: {
          [require('sequelize').Op.between]: [new Date(start_date), new Date(end_date)]
        }
      };
    }

    // Session completion rates
    const totalSessions = await Session.count({ where: dateFilter });
    const completedSessions = await Session.count({ 
      where: { ...dateFilter, status: 'Completed' } 
    });
    const cancelledSessions = await Session.count({ 
      where: { ...dateFilter, status: 'Cancelled' } 
    });

    // Attendance analysis (basic)
    const sessionsWithAttendance = await Session.findAll({
      where: { ...dateFilter, status: 'Completed' },
      attributes: ['attendance']
    });

    let totalAttendance = 0;
    let totalStudentSessions = 0;

    sessionsWithAttendance.forEach(session => {
      if (session.attendance) {
        const attendanceData = session.attendance;
        Object.values(attendanceData).forEach(status => {
          totalStudentSessions++;
          if (status === 'present') totalAttendance++;
        });
      }
    });

    const attendanceRate = totalStudentSessions > 0 ? 
      Math.round((totalAttendance / totalStudentSessions) * 100) : 0;

    // Batch completion rates
    const totalBatches = await Batch.count();
    const completedBatches = await Batch.count({ where: { status: 'Completed' } });
    const activeBatches = await Batch.count({ where: { status: 'Active' } });

    // Tutor performance
    const tutorStats = await User.findAll({
      where: { role: 'tutor', is_active: true },
      include: [{
        model: Session,
        as: 'assignedSessions',
        where: { ...dateFilter, status: 'Completed' },
        required: false
      }],
      attributes: ['id', 'first_name', 'last_name']
    });

    const tutorPerformance = tutorStats.map(tutor => ({
      id: tutor.id,
      name: `${tutor.first_name} ${tutor.last_name}`,
      sessions_completed: tutor.assignedSessions?.length || 0
    }));

    // Course popularity
    const courseStats = await Course.findAll({
      include: [{
        model: Batch,
        as: 'batches',
        include: [{
          model: Enrollment,
          as: 'enrollments',
          where: { status: 'Active' },
          required: false
        }]
      }],
      where: { is_active: true }
    });

    const coursePopularity = courseStats.map(course => ({
      id: course.id,
      name: course.name,
      total_enrollments: course.batches?.reduce((sum, batch) => 
        sum + (batch.enrollments?.length || 0), 0) || 0,
      active_batches: course.batches?.filter(batch => batch.status === 'Active').length || 0
    }));

    res.json({
      session_stats: {
        total_sessions: totalSessions,
        completed_sessions: completedSessions,
        cancelled_sessions: cancelledSessions,
        completion_rate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0
      },
      attendance_stats: {
        attendance_rate: attendanceRate,
        total_student_sessions: totalStudentSessions
      },
      batch_stats: {
        total_batches: totalBatches,
        completed_batches: completedBatches,
        active_batches: activeBatches,
        completion_rate: totalBatches > 0 ? Math.round((completedBatches / totalBatches) * 100) : 0
      },
      tutor_performance: tutorPerformance,
      course_popularity: coursePopularity
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

// Export data for reports
router.get('/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'json', start_date, end_date } = req.query;

    let data = [];
    let filename = '';

    switch (type) {
      case 'users':
        data = await User.findAll({
          attributes: ['email', 'first_name', 'last_name', 'role', 'is_active', 'created_at'],
          order: [['created_at', 'DESC']]
        });
        filename = 'users_export';
        break;

      case 'sessions':
        let dateFilter = {};
        if (start_date && end_date) {
          dateFilter = {
            scheduled_datetime: {
              [require('sequelize').Op.between]: [new Date(start_date), new Date(end_date)]
            }
          };
        }

        data = await Session.findAll({
          where: dateFilter,
          include: [
            {
              model: Batch,
              as: 'batch',
              include: [{ model: Course, as: 'course' }]
            },
            { model: User, as: 'assignedTutor', attributes: ['first_name', 'last_name'] }
          ],
          order: [['scheduled_datetime', 'DESC']]
        });
        filename = 'sessions_export';
        break;

      case 'enrollments':
        data = await Enrollment.findAll({
          include: [
            { 
              model: User, 
              as: 'student',
              attributes: ['first_name', 'last_name', 'email']
            },
            {
              model: Batch,
              as: 'batch',
              include: [{ model: Course, as: 'course', attributes: ['name'] }]
            }
          ],
          order: [['created_at', 'DESC']]
        });
        filename = 'enrollments_export';
        break;

      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'csv') {
      // Simple CSV conversion (you might want to use a proper CSV library)
      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      res.json(data);
    }

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Helper function for CSV conversion
function convertToCSV(data) {
  if (!data.length) return '';
  
  const headers = Object.keys(data[0].toJSON ? data[0].toJSON() : data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => {
      const obj = row.toJSON ? row.toJSON() : row;
      return headers.map(header => {
        const value = obj[header];
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value).replace(/"/g, '""');
        }
        return `"${String(value || '').replace(/"/g, '""')}"`;
      }).join(',');
    })
  ].join('\n');
  
  return csvContent;
}

module.exports = router;
