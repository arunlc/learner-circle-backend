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

module.exports = router;
