// migrations/002-add-materials.js - Add materials support to existing batches

const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    // Add materials column to Batches table
    await queryInterface.addColumn('Batches', 'materials', {
      type: DataTypes.JSONB,
      defaultValue: {
        course_materials: [],
        session_materials: {}
      },
      allowNull: false
    });

    // Add index for better performance on materials queries
    await queryInterface.addIndex('Batches', {
      fields: ['materials'],
      name: 'batches_materials_idx',
      using: 'gin'
    });

    console.log('✅ Materials column added to Batches table');
  },

  down: async (queryInterface) => {
    // Remove the index first
    await queryInterface.removeIndex('Batches', 'batches_materials_idx');
    
    // Remove the materials column
    await queryInterface.removeColumn('Batches', 'materials');
    
    console.log('✅ Materials column removed from Batches table');
  }
};

// How to run this migration:
// 1. Create this file in your migrations/ folder
// 2. Run: node migrations/migrate.js
// 
// Or if you want to update existing batches manually:
// 
// UPDATE "Batches" 
// SET materials = '{"course_materials": [], "session_materials": {}}'::jsonb 
// WHERE materials IS NULL;

// Script to populate sample materials for testing
const sampleMaterials = {
  course_materials: [
    {
      id: "mat_001",
      name: "Course Handbook",
      type: "document",
      url: "https://drive.google.com/file/d/sample_handbook",
      description: "Complete guide covering all course topics",
      added_by: "admin_user_id",
      added_at: new Date().toISOString(),
      is_required: true
    },
    {
      id: "mat_002", 
      name: "Introduction Video",
      type: "video",
      url: "https://youtube.com/watch?v=sample_intro",
      description: "Welcome video introducing the course structure",
      added_by: "admin_user_id",
      added_at: new Date().toISOString(),
      is_required: false
    }
  ],
  session_materials: {
    "1": [
      {
        id: "mat_003",
        name: "Session 1 Worksheet", 
        type: "document",
        url: "https://drive.google.com/file/d/session1_worksheet",
        description: "Practice problems for session 1",
        added_by: "tutor_user_id",
        added_at: new Date().toISOString()
      }
    ],
    "3": [
      {
        id: "mat_004",
        name: "Advanced Concepts Video",
        type: "video", 
        url: "https://youtube.com/watch?v=advanced_concepts",
        description: "Deep dive into advanced topics",
        added_by: "tutor_user_id",
        added_at: new Date().toISOString()
      }
    ]
  }
};
