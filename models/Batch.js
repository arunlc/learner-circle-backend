// models/Batch.js - Complete Enhanced Version with Materials Support

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
  },
  // Materials Management
  materials: {
    type: DataTypes.JSONB,
    defaultValue: {
      course_materials: [], // Available to all sessions
      session_materials: {} // Specific to sessions
    }
    /* 
    Structure:
    {
      course_materials: [
        {
          id: "mat_uuid",
          name: "Main Textbook",
          type: "document", // document, video, audio, link, image
          url: "https://drive.google.com/...",
          description: "Course reference book",
          added_by: "user_uuid",
          added_at: "2024-01-15T10:30:00Z",
          is_required: true
        }
      ],
      session_materials: {
        "1": [
          {
            id: "mat_uuid",
            name: "Session 1 Worksheet",
            type: "document",
            url: "https://drive.google.com/...",
            description: "Practice problems for session 1",
            added_by: "user_uuid",
            added_at: "2024-01-15T10:30:00Z"
          }
        ],
        "3": [...],
        "5": [...]
      }
    }
    */
  }
}, {
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Helper methods for materials management
// Replace the methods in your Batch.js with these enhanced versions:

// Helper methods for materials management
// FIXED Batch.js Model - Replace the helper methods in your Batch.js with these corrected versions:

// CLEANED Batch.js Model - Production Ready (replace the helper methods):

Batch.prototype.addCourseMaterial = async function(material, addedByUserId) {
  // Get current materials or initialize
  const currentMaterials = this.materials || { course_materials: [], session_materials: {} };
  
  // Create new material object
  const newMaterial = {
    id: require('uuid').v4(),
    ...material,
    added_by: addedByUserId,
    added_at: new Date().toISOString()
  };
  
  // Create a completely new object to ensure Sequelize detects the change
  const updatedMaterials = {
    course_materials: [...currentMaterials.course_materials, newMaterial],
    session_materials: { ...currentMaterials.session_materials }
  };
  
  try {
    await this.update(
      { materials: updatedMaterials },
      { 
        fields: ['materials'],
        returning: true
      }
    );
    
    // Update the instance's materials property
    this.materials = updatedMaterials;
    
    return this;
  } catch (error) {
    console.error('Database update failed:', error);
    throw error;
  }
};

Batch.prototype.addSessionMaterial = async function(sessionNumber, material, addedByUserId) {
  // Get current materials or initialize
  const currentMaterials = this.materials || { course_materials: [], session_materials: {} };
  
  // Create new material object
  const newMaterial = {
    id: require('uuid').v4(),
    ...material,
    added_by: addedByUserId,
    added_at: new Date().toISOString()
  };
  
  // Create completely new nested objects
  const sessionKey = sessionNumber.toString();
  const updatedSessionMaterials = { ...currentMaterials.session_materials };
  updatedSessionMaterials[sessionKey] = [
    ...(updatedSessionMaterials[sessionKey] || []),
    newMaterial
  ];
  
  const updatedMaterials = {
    course_materials: [...currentMaterials.course_materials],
    session_materials: updatedSessionMaterials
  };
  
  try {
    await this.update(
      { materials: updatedMaterials },
      { 
        fields: ['materials'],
        returning: true
      }
    );
    
    // Update the instance's materials property
    this.materials = updatedMaterials;
    
    return this;
  } catch (error) {
    console.error('Session material database update failed:', error);
    throw error;
  }
};

Batch.prototype.removeMaterial = async function(materialId, sessionNumber = null) {
  const currentMaterials = this.materials || { course_materials: [], session_materials: {} };
  
  let updatedMaterials;
  
  if (sessionNumber) {
    // Remove from session materials
    const sessionKey = sessionNumber.toString();
    const updatedSessionMaterials = { ...currentMaterials.session_materials };
    
    if (updatedSessionMaterials[sessionKey]) {
      updatedSessionMaterials[sessionKey] = updatedSessionMaterials[sessionKey]
        .filter(mat => mat.id !== materialId);
    }
    
    updatedMaterials = {
      course_materials: [...currentMaterials.course_materials],
      session_materials: updatedSessionMaterials
    };
  } else {
    // Remove from course materials
    updatedMaterials = {
      course_materials: currentMaterials.course_materials.filter(mat => mat.id !== materialId),
      session_materials: { ...currentMaterials.session_materials }
    };
  }
  
  try {
    await this.update(
      { materials: updatedMaterials },
      { 
        fields: ['materials'],
        returning: true
      }
    );
    
    // Update the instance's materials property
    this.materials = updatedMaterials;
    
    return this;
  } catch (error) {
    console.error('Material removal database update failed:', error);
    throw error;
  }
};

Batch.prototype.getStudentMaterials = function() {
  const materials = this.materials || { course_materials: [], session_materials: {} };
  
  // Return materials organized for student view
  return {
    course_materials: materials.course_materials.map(mat => ({
      id: mat.id,
      name: mat.name,
      type: mat.type,
      url: mat.url,
      description: mat.description,
      is_required: mat.is_required,
      added_at: mat.added_at
    })),
    session_materials: Object.keys(materials.session_materials).reduce((acc, sessionNum) => {
      acc[sessionNum] = materials.session_materials[sessionNum].map(mat => ({
        id: mat.id,
        name: mat.name,
        type: mat.type,
        url: mat.url,
        description: mat.description,
        added_at: mat.added_at
      }));
      return acc;
    }, {})
  };
};

module.exports = Batch;
