# migrations/001-initial-setup.js
const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    // Create ENUM types
    await queryInterface.sequelize.query(`
      CREATE TYPE user_role AS ENUM ('admin', 'tutor', 'student', 'parent');
      CREATE TYPE skill_level_enum AS ENUM ('Beginner', 'Intermediate', 'Advanced');
      CREATE TYPE batch_status AS ENUM ('Active', 'Completed', 'Paused', 'Cancelled');
      CREATE TYPE session_status AS ENUM ('Scheduled', 'Completed', 'Cancelled', 'Rescheduled');
      CREATE TYPE enrollment_status AS ENUM ('Active', 'Completed', 'Dropped', 'Transferred');
      CREATE TYPE payment_status_enum AS ENUM ('Paid', 'Pending', 'Partial', 'Refunded');
    `);

    // Create Users table
    await queryInterface.createTable('Users', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
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
        type: 'user_role',
        allowNull: false
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true
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
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Create Courses table
    await queryInterface.createTable('Courses', {
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
        type: 'skill_level_enum',
        allowNull: false
      },
      total_sessions: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      session_duration_minutes: {
        type: DataTypes.INTEGER,
        defaultValue: 60
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
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Create Batches table
    await queryInterface.createTable('Batches', {
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
      },
      status: {
        type: 'batch_status',
        defaultValue: 'Active'
      },
      drive_folder_id: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      progress: {
        type: DataTypes.JSONB,
        defaultValue: { current_session: 1, completed_sessions: 0 }
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Create Sessions table
    await queryInterface.createTable('Sessions', {
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
        type: 'session_status',
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
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Create Enrollments table
    await queryInterface.createTable('Enrollments', {
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
        type: 'enrollment_status',
        defaultValue: 'Active'
      },
      payment_status: {
        type: 'payment_status_enum',
        defaultValue: 'Pending'
      },
      progress_data: {
        type: DataTypes.JSONB,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Create indexes for better performance
    await queryInterface.addIndex('Users', ['email']);
    await queryInterface.addIndex('Users', ['role']);
    await queryInterface.addIndex('Batches', ['course_id']);
    await queryInterface.addIndex('Batches', ['current_tutor_id']);
    await queryInterface.addIndex('Batches', ['status']);
    await queryInterface.addIndex('Sessions', ['batch_id']);
    await queryInterface.addIndex('Sessions', ['assigned_tutor_id']);
    await queryInterface.addIndex('Sessions', ['scheduled_datetime']);
    await queryInterface.addIndex('Sessions', ['status']);
    await queryInterface.addIndex('Enrollments', ['batch_id']);
    await queryInterface.addIndex('Enrollments', ['student_id']);
    await queryInterface.addIndex('Enrollments', ['status']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Enrollments');
    await queryInterface.dropTable('Sessions');
    await queryInterface.dropTable('Batches');
    await queryInterface.dropTable('Courses');
    await queryInterface.dropTable('Users');
    
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS user_role;
      DROP TYPE IF EXISTS skill_level_enum;
      DROP TYPE IF EXISTS batch_status;
      DROP TYPE IF EXISTS session_status;
      DROP TYPE IF EXISTS enrollment_status;
      DROP TYPE IF EXISTS payment_status_enum;
    `);
  }
};
