const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Batch = sequelize.define('Batch', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  course_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Courses',
      key: 'id'
    }
  },
  batch_number: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  batch_name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  current_tutor_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  max_students: {
    type: DataTypes.INTEGER,
    defaultValue: 5
  },
  schedule: {
    type: DataTypes.JSONB,
    allowNull: false
    // Format: [{"day": "Thursday", "time": "16:00"}, ...]
  },
  status: {
    type: DataTypes.ENUM('Active', 'Completed', 'Paused', 'Cancelled'),
    defaultValue: 'Active'
  },
  drive_folder_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  progress: {
    type: DataTypes.JSONB,
    defaultValue: {
      current_session: 1,
      completed_sessions: 0
    }
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Batch;
