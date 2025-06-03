// models/Course.js - Updated with proper field mapping

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Course = sequelize.define('Course', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  skill_level: {
    type: DataTypes.ENUM('Beginner', 'Intermediate', 'Advanced'),
    allowNull: false
  },
  // FIXED: Use suggested_sessions to match frontend
  suggested_sessions: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 50
    }
  },
  session_duration_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 60,
    validate: {
      min: 15,
      max: 180
    }
  },
  curriculum: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  prerequisites: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Course;
