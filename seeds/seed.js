const bcrypt = require('bcryptjs');
const { User, Course } = require('../models');

async function seedDatabase() {
  try {
    console.log('Starting database seeding...');

    // Create admin user
    const adminExists = await User.findOne({ where: { email: 'admin@learner-circle.com' } });
    if (!adminExists) {
      await User.create({
        email: 'admin@learner-circle.com',
        password_hash: 'admin123', // Will be hashed by the model hook
        first_name: 'System',
        last_name: 'Administrator',
        role: 'admin',
        phone: '+91-9999999999',
        profile_data: { isSystemAdmin: true }
      });
      console.log('✓ Admin user created');
    }

    // Create sample tutor
    const tutorExists = await User.findOne({ where: { email: 'tutor@example.com' } });
    if (!tutorExists) {
      await User.create({
        email: 'tutor@example.com',
        password_hash: 'tutor123',
        first_name: 'John',
        last_name: 'Doe',
        role: 'tutor',
        phone: '+91-9876543210',
        profile_data: { 
          specializations: ['Chess', 'Piano'],
          experience_years: 5
        }
      });
      console.log('✓ Sample tutor created');
    }

    // Create sample student
    const studentExists = await User.findOne({ where: { email: 'student@example.com' } });
    if (!studentExists) {
      await User.create({
        email: 'student@example.com',
        password_hash: 'student123',
        first_name: 'Jane',
        last_name: 'Smith',
        role: 'student',
        phone: '+91-9876543211',
        profile_data: { 
          age: 12,
          interests: ['Chess', 'Music']
        }
      });
      console.log('✓ Sample student created');
    }

    // Create sample courses
    const chessExists = await Course.findOne({ where: { name: 'Chess Level 1' } });
    if (!chessExists) {
      await Course.create({
        name: 'Chess Level 1',
        description: 'Introduction to chess for beginners',
        skill_level: 'Beginner',
        total_sessions: 8,
        session_duration_minutes: 60,
        curriculum: [
          { session: 1, topic: 'Introduction to Chess Board and Pieces' },
          { session: 2, topic: 'How Pieces Move' },
          { session: 3, topic: 'Special Moves: Castling and En Passant' },
          { session: 4, topic: 'Basic Opening Principles' },
          { session: 5, topic: 'Basic Tactics: Pins and Forks' },
          { session: 6, topic: 'Basic Endgames: King and Queen vs King' },
          { session: 7, topic: 'Chess Notation and Analysis' },
          { session: 8, topic: 'Practice Games and Review' }
        ],
        prerequisites: []
      });
      console.log('✓ Chess Level 1 course created');
    }

    const pianoExists = await Course.findOne({ where: { name: 'Piano Basics' } });
    if (!pianoExists) {
      await Course.create({
        name: 'Piano Basics',
        description: 'Learn piano fundamentals',
        skill_level: 'Beginner',
        total_sessions: 10,
        session_duration_minutes: 45,
        curriculum: [
          { session: 1, topic: 'Keyboard Layout and Posture' },
          { session: 2, topic: 'Basic Hand Position' },
          { session: 3, topic: 'Reading Simple Notes' },
          { session: 4, topic: 'Right Hand Melodies' },
          { session: 5, topic: 'Left Hand Bass Notes' },
          { session: 6, topic: 'Both Hands Together' },
          { session: 7, topic: 'Simple Songs Practice' },
          { session: 8, topic: 'Rhythm and Timing' },
          { session: 9, topic: 'Expression and Dynamics' },
          { session: 10, topic: 'Performance and Review' }
        ],
        prerequisites: []
      });
      console.log('✓ Piano Basics course created');
    }

    console.log('Database seeding completed successfully!');
    
    console.log('\n📝 Login Credentials:');
    console.log('Admin: admin@learner-circle.com / admin123');
    console.log('Tutor: tutor@example.com / tutor123');
    console.log('Student: student@example.com / student123');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

// Run seeding if called directly
if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}

module.exports = seedDatabase;
