const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  batch_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Batches',
      key: 'id'
    }
  },
  session_number: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  curriculum_topic: {
    type: DataTypes.STRING(300),
    allowNull: true
  },
  scheduled_datetime: {
    type: DataTypes.DATE,
    allowNull: false
  },
  assigned_tutor_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  gmeet_link: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  gmeet_meeting_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  recording_link: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('Scheduled', 'Completed', 'Cancelled', 'Rescheduled'),
    defaultValue: 'Scheduled'
  },
  attendance: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  tutor_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  session_materials: {
    type: DataTypes.JSONB,
    defaultValue: []
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Session;
