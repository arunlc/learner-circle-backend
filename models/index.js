const User = require('./User');
const Course = require('./Course');
const Batch = require('./Batch');
const Session = require('./Session');
const Enrollment = require('./Enrollment');

// Define associations
Course.hasMany(Batch, { foreignKey: 'course_id', as: 'batches' });
Batch.belongsTo(Course, { foreignKey: 'course_id', as: 'course' });

User.hasMany(Batch, { foreignKey: 'current_tutor_id', as: 'tutoredBatches' });
Batch.belongsTo(User, { foreignKey: 'current_tutor_id', as: 'currentTutor' });

Batch.hasMany(Session, { foreignKey: 'batch_id', as: 'sessions' });
Session.belongsTo(Batch, { foreignKey: 'batch_id', as: 'batch' });

User.hasMany(Session, { foreignKey: 'assigned_tutor_id', as: 'assignedSessions' });
Session.belongsTo(User, { foreignKey: 'assigned_tutor_id', as: 'assignedTutor' });

Batch.hasMany(Enrollment, { foreignKey: 'batch_id', as: 'enrollments' });
Enrollment.belongsTo(Batch, { foreignKey: 'batch_id', as: 'batch' });

User.hasMany(Enrollment, { foreignKey: 'student_id', as: 'enrollments' });
Enrollment.belongsTo(User, { foreignKey: 'student_id', as: 'student' });

module.exports = {
  User,
  Course,
  Batch,
  Session,
  Enrollment
};
