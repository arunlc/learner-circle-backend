# Learner Circle Backend API

Complete Node.js backend for the Learner Circle educational platform with multi-frontend architecture.

## Features

- **Role-based Authentication**: Admin, Tutor, Student, Parent roles
- **Smart Batch Management**: Automated scheduling with conflict detection
- **Google Workspace Integration**: Meet links and Drive storage
- **Security-First Design**: Zero contact sharing between users
- **Session Access Control**: Time-limited tokens for session access
- **RESTful API**: Clean, documented endpoints for all frontends

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Google Workspace account with API access

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository>
cd learner-circle-backend
npm install
```

2. **Setup environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Setup database:**
```bash
# Create PostgreSQL database
createdb learner_circle

# Run migrations
npm run migrate

# Seed initial data
npm run seed
```

4. **Start development server:**
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get current user profile
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout user

### Admin Endpoints (`/api/admin/`)
- `GET /dashboard` - Admin dashboard data
- `POST /courses` - Create new course
- `GET /courses` - List all courses
- `POST /batches` - Create batch with auto-scheduling
- `GET /batches` - List batches with filters
- `POST /users` - Create tutor/student accounts
- `GET /users` - List users with role filters

### Tutor Endpoints (`/api/tutor/`)
- `GET /dashboard` - Today's sessions and batch info
- `GET /sessions` - Upcoming sessions with join links
- `POST /sessions/:id/attendance` - Mark attendance
- `POST /sessions/:id/notes` - Add session notes
- `GET /batches` - Assigned batches
- `GET /materials/:batchId` - Access curriculum materials

### Student Endpoints (`/api/student/`)
- `GET /dashboard` - Next session and progress
- `GET /sessions` - Upcoming sessions
- `GET /recordings` - Available session recordings
- `GET /progress` - Learning progress tracking
- `PUT /profile` - Update limited profile fields

### Secure Session Access (`/session/`)
- `GET /:sessionId/token` - Get session access token
- `GET /:sessionId/tutor` - Secure tutor session access
- `GET /:sessionId/student` - Secure student session access
- `GET /:sessionId/admin` - Admin session monitoring

## Security Features

### Contact Information Protection
- Students and tutors never see each other's contact details
- Role-based data filtering in all API responses
- Encrypted phone number storage (TODO: implement encryption)

### Session Access Control
- Time-limited session tokens (2-hour expiry)
- Platform-mediated Google Meet access
- No direct meeting links shared

### Authentication & Authorization
- JWT-based authentication with role guards
- Bcrypt password hashing
- Rate limiting on auth endpoints
- CORS protection for multi-frontend setup

## Database Schema

### Core Models
- **Users**: Admin, Tutor, Student, Parent accounts
- **Courses**: Course definitions with curriculum
- **Batches**: Course instances with scheduling
- **Sessions**: Individual class sessions with Google Meet integration
- **Enrollments**: Student batch enrollments with progress tracking

### Key Relationships
- Users can be tutors for multiple batches
- Batches belong to courses and have multiple sessions
- Students enroll in batches through enrollments
- Sessions are assigned to tutors and track attendance

## Google Workspace Integration

### Required Setup
1. Google Workspace Business account
2. Service account with domain-wide delegation
3. Enabled APIs: Calendar, Drive, Admin SDK
4. OAuth 2.0 credentials configured

### Features
- **Google Meet**: Automatic meeting creation for sessions
- **Google Drive**: Batch folders and material storage
- **Google Calendar**: Session scheduling integration

## Smart Scheduling Engine

### Auto-Batch Generation
- Validates tutor availability and conflicts
- Respects holidays and leave requests
- Generates sessions based on weekly schedules
- Handles curriculum mapping automatically

### Conflict Detection
- Tutor double-booking prevention
- Holiday awareness (Indian holidays included)
- Business hours validation (9 AM - 9 PM)
- Buffer time between sessions

## Development Guidelines

### Code Structure
```
backend/
├── models/           # Sequelize database models
├── controllers/      # Business logic (not used, logic in routes)
├── routes/           # API endpoints grouped by role
├── middleware/       # Auth, validation, error handling
├── services/         # External integrations (Google APIs)
├── migrations/       # Database schema migrations
├── seeds/           # Initial data seeding
└── server.js        # Main application entry point
```

### Adding New Features
1. Update database schema in migrations/
2. Add/modify Sequelize models
3. Implement API endpoints in appropriate route file
4. Add proper authentication and role guards
5. Update this README with new endpoints

### Testing
- Unit tests for models and services
- Integration tests for API endpoints
- Role-based access control testing
- Google API mocking for tests

## Deployment

### Environment Setup
1. **Database**: PostgreSQL on Render or similar
2. **Application**: Node.js on Render
3. **Environment Variables**: All secrets in deployment platform

### Production Checklist
- [ ] Database migrations run
- [ ] Google Workspace APIs configured
- [ ] CORS origins set for production domains
- [ ] JWT secrets securely generated
- [ ] SSL/HTTPS enabled
- [ ] Rate limiting configured
- [ ] Error monitoring setup

## Monitoring & Maintenance

### Health Checks
- `GET /health` - Basic health check endpoint
- Database connection monitoring
- Google API quota tracking

### Logging
- Structured logging for all API requests
- Error tracking with stack traces
- Performance monitoring for slow queries

### Backup Strategy
- Daily PostgreSQL database backups
- Google Drive folder backup verification
- Environment variable backup

## Troubleshooting

### Common Issues

**Database Connection Errors:**
```bash
# Check PostgreSQL connection
psql $DATABASE_URL

# Verify environment variables
echo $DATABASE_URL
```

**Google API Authentication:**
```bash
# Test Google credentials
node -e "const {google} = require('googleapis'); console.log('Google APIs loaded successfully');"
```

**CORS Issues:**
- Verify CORS_ORIGINS environment variable includes all frontend domains
- Check that frontend is sending credentials with requests

### Development vs Production

**Development:**
- Uses local PostgreSQL database
- CORS allows localhost origins
- Detailed error messages
- Console logging enabled

**Production:**
- Managed PostgreSQL on Render
- CORS restricted to production domains
- Generic error messages
- Structured logging only

## API Response Formats

### Success Response
```json
{
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "error": "Error description",
  "details": "Additional error details (development only)"
}
```

### Pagination (where applicable)
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
```

## Frontend Integration

The backend is designed to work with 3 separate React frontends:

1. **Admin Frontend** (`admin.learner-circle.com`)
   - Full system control and user management
   - Batch creation and course management
   - Analytics and reporting

2. **Tutor Frontend** (`tutor.learner-circle.com`)
   - Session delivery and attendance marking
   - Curriculum access and materials
   - Student progress (no contact info)

3. **Student Frontend** (`student.learner-circle.com`)
   - Session joining and progress tracking
   - Recording access and materials
   - Limited profile management

Each frontend should:
- Store JWT token in memory (not localStorage)
- Include `Authorization: Bearer <token>` header
- Handle token refresh automatically
- Implement role-based routing

## Contributing

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/new-feature`
3. **Commit changes**: `git commit -m 'Add new feature'`
4. **Push to branch**: `git push origin feature/new-feature`
5. **Submit pull request**

### Code Standards
- Use ESLint configuration
- Follow existing naming conventions
- Add JSDoc comments for complex functions
- Include unit tests for new features
- Update API documentation

## License

This project is proprietary software for Learner Circle educational platform.

---

**Need Help?**
- Check the troubleshooting section above
- Review API documentation in route files
- Test endpoints using the provided Postman collection
- Contact the development team for supportauth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User } = require('../models');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Login endpoint
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ where: { email, is_active: true } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return role-appropriate user data
    const userData = user.getSecureView(user.role);

    res.json({
      token,
      user: userData,
      role: user.role
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userData = req.user.getSecureView(req.user.role);
    res.json({ user: userData });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Token refresh
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    const token = jwt.sign(
      { id: req.user.id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Logout (client-side token removal)
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
