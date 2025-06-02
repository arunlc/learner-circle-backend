const express = require('express');
const jwt = require('jsonwebtoken');
const { Session, Batch, Course, User, Enrollment } = require('../models');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Generate secure session access token
const generateSessionToken = (sessionId, userId, role) => {
  return jwt.sign(
    { sessionId, userId, role, type: 'session_access' },
    process.env.JWT_SECRET,
    { expiresIn: '2h' } // Session tokens expire in 2 hours
  );
};

// Validate session access token
const validateSessionToken = (req, res, next) => {
  try {
    const token = req.query.token || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Session access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'session_access') {
      return res.status(401).json({ error: 'Invalid session token type' });
    }

    if (decoded.sessionId !== req.params.sessionId) {
      return res.status(401).json({ error: 'Token session mismatch' });
    }

    req.sessionToken = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
};

// Get session access token (for authenticated users)
router.get('/:sessionId/token', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Verify user has access to this session
    const session = await Session.findByPk(sessionId, {
      include: [
        {
          model: Batch,
          as: 'batch',
          include: [
            { model: Enrollment, as: 'enrollments' }
          ]
        }
      ]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    let hasAccess = false;

    if (userRole === 'admin') {
      hasAccess = true;
    } else if (userRole === 'tutor' && session.assigned_tutor_id === userId) {
      hasAccess = true;
    } else if (userRole === 'student') {
      const enrollment = session.batch.enrollments.find(e => 
        e.student_id === userId && e.status === 'Active'
      );
      hasAccess = !!enrollment;
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this session' });
    }

    // Generate time-limited session access token
    const sessionToken = generateSessionToken(sessionId, userId, userRole);

    res.json({
      sessionToken,
      expiresIn: '2h',
      sessionId
    });
  } catch (error) {
    console.error('Session token generation error:', error);
    res.status(500).json({ error: 'Failed to generate session token' });
  }
});

// Secure tutor session access
router.get('/:sessionId/tutor', validateSessionToken, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const { userId, role } = req.sessionToken;

    if (role !== 'tutor' && role !== 'admin') {
      return res.status(403).json({ error: 'Tutor access required' });
    }

    const session = await Session.findByPk(sessionId, {
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
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify tutor assignment (unless admin)
    if (role === 'tutor' && session.assigned_tutor_id !== userId) {
      return res.status(403).json({ error: 'Not assigned to this session' });
    }

    // Filter student contact information
    const sessionData = session.toJSON();
    if (sessionData.batch?.enrollments) {
      sessionData.batch.enrollments = sessionData.batch.enrollments.map(enrollment => ({
        ...enrollment,
        student: enrollment.student ? enrollment.student.getSecureView('tutor') : null
      }));
    }

    // Return session with Google Meet link
    res.json({
      session: sessionData,
      meetLink: session.gmeet_link,
      accessType: 'tutor'
    });
  } catch (error) {
    console.error('Tutor session access error:', error);
    res.status(500).json({ error: 'Failed to access session' });
  }
});

// Secure student session access
router.get('/:sessionId/student', validateSessionToken, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const { userId, role } = req.sessionToken;

    if (role !== 'student' && role !== 'admin') {
      return res.status(403).json({ error: 'Student access required' });
    }

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
              where: { status: 'Active' },
              required: false
            }
          ]
        }
      ]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify student enrollment (unless admin)
    if (role === 'student') {
      const enrollment = session.batch.enrollments.find(e => e.student_id === userId);
      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this batch' });
      }
    }

    // Filter tutor contact information
    const sessionData = session.toJSON();
    sessionData.batch.currentTutor = session.batch.currentTutor ? 
      session.batch.currentTutor.getSecureView('student') : null;

    // Return session with Google Meet link
    res.json({
      session: sessionData,
      meetLink: session.gmeet_link,
      accessType: 'student'
    });
  } catch (error) {
    console.error('Student session access error:', error);
    res.status(500).json({ error: 'Failed to access session' });
  }
});

// Admin session monitoring access
router.get('/:sessionId/admin', validateSessionToken, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const { role } = req.sessionToken;

    if (role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

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
        }
      ]
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Admin sees full contact information
    const sessionData = session.toJSON();
    if (sessionData.batch?.enrollments) {
      sessionData.batch.enrollments = sessionData.batch.enrollments.map(enrollment => ({
        ...enrollment,
        student: enrollment.student ? enrollment.student.getSecureView('admin') : null
      }));
    }
    
    if (sessionData.batch?.currentTutor) {
      sessionData.batch.currentTutor = sessionData.batch.currentTutor.getSecureView('admin');
    }

    res.json({
      session: sessionData,
      meetLink: session.gmeet_link,
      accessType: 'admin'
    });
  } catch (error) {
    console.error('Admin session access error:', error);
    res.status(500).json({ error: 'Failed to access session' });
  }
});

module.exports = router;
