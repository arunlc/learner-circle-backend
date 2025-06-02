const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'tutor', 'student', 'parent'),
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true
    // TODO: Implement encryption for phone numbers
  },
  timezone: {
    type: DataTypes.STRING(50),
    defaultValue: 'Asia/Kolkata'
  },
  profile_data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  hooks: {
    beforeCreate: async (user) => {
      if (user.password_hash) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password_hash')) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    }
  }
});

User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password_hash);
};

// Security method to return filtered user data based on viewer role
User.prototype.getSecureView = function(viewerRole) {
  const baseInfo = {
    id: this.id,
    first_name: this.first_name,
    role: this.role,
    is_active: this.is_active
  };

  if (viewerRole === 'admin') {
    return {
      ...baseInfo,
      last_name: this.last_name,
      email: this.email,
      phone: this.phone,
      timezone: this.timezone,
      profile_data: this.profile_data,
      created_at: this.created_at
    };
  } else {
    return {
      ...baseInfo,
      last_name: this.last_name ? this.last_name[0] + '.' : ''
      // Never expose email, phone, or contact info to non-admin roles
    };
  }
};

module.exports = User;
