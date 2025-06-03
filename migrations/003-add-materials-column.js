// migrations/003-add-materials-column.js
const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    try {
      // Check if column already exists
      const tableDescription = await queryInterface.describeTable('Batches');
      
      if (!tableDescription.materials) {
        console.log('Adding materials column to Batches table...');
        
        // Add materials column
        await queryInterface.addColumn('Batches', 'materials', {
          type: DataTypes.JSONB,
          defaultValue: {
            course_materials: [],
            session_materials: {}
          },
          allowNull: false
        });

        // Update existing records
        await queryInterface.sequelize.query(`
          UPDATE "Batches" 
          SET materials = '{"course_materials": [], "session_materials": {}}'::jsonb 
          WHERE materials IS NULL;
        `);

        // Add index
        await queryInterface.addIndex('Batches', {
          fields: ['materials'],
          name: 'batches_materials_idx',
          using: 'gin'
        });

        console.log('✅ Materials column added successfully');
      } else {
        console.log('✅ Materials column already exists');
      }
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('Batches', 'batches_materials_idx');
    await queryInterface.removeColumn('Batches', 'materials');
  }
};
