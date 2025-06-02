const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Enrollment = sequelize.define('Enrollment', {
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
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  enrollment_date: {
    type: DataTypes.DATEONLY,
    defaultValue: DataTypes.NOW
  },
  status: {
    type: DataTypes.ENUM('Active', 'Completed', 'Dropped', 'Transferred'),
    defaultValue: 'Active'
  },
  payment_status: {
    type: DataTypes.ENUM('Paid', 'Pending', 'Partial', 'Refunded'),
    defaultValue: 'Pending'
  },
  progress_data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Enrollment;
