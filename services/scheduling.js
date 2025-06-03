// services/scheduling.js
const moment = require('moment-timezone');

class SchedulingService {
  constructor() {
    this.timezone = 'Asia/Kolkata';
  }

  async generateBatchSessions(batchConfig) {
    const { batch_id, course_id, start_date, session_count, schedule, tutor_id, curriculum } = batchConfig;
    const sessions = [];
    
    let currentDate = moment(start_date).tz(this.timezone);
    let sessionNumber = 1;
    
    while (sessionNumber <= session_count) {
      const nextSessionDate = this.findNextValidSessionDate(currentDate, schedule, tutor_id);
      
      if (nextSessionDate && await this.isValidSessionDateTime(nextSessionDate, tutor_id)) {
        const curriculumTopic = this.getCurriculumTopic(curriculum, sessionNumber);
        
        sessions.push({
          batch_id,
          session_number: sessionNumber,
          curriculum_topic: curriculumTopic,
          scheduled_datetime: nextSessionDate.toDate(),
          assigned_tutor_id: tutor_id,
          status: 'Scheduled'
        });
        
        sessionNumber++;
      }
      
      currentDate = nextSessionDate ? nextSessionDate.clone().add(1, 'day') : currentDate.add(1, 'day');
      
      // Safety check to prevent infinite loops
      if (currentDate.diff(moment(start_date), 'months') > 12) {
        throw new Error('Unable to schedule all sessions within reasonable timeframe');
      }
    }
    
    return sessions;
  }

  findNextValidSessionDate(fromDate, schedule, tutorId) {
    // schedule format: [{"day": "Thursday", "time": "16:00"}, ...]
    let searchDate = fromDate.clone();
    
    for (let i = 0; i < 14; i++) { // Search up to 2 weeks ahead
      const dayName = searchDate.format('dddd');
      const scheduleItem = schedule.find(s => s.day === dayName);
      
      if (scheduleItem) {
        const sessionDateTime = searchDate.clone()
          .hour(parseInt(scheduleItem.time.split(':')[0]))
          .minute(parseInt(scheduleItem.time.split(':')[1]))
          .second(0);
        
        if (sessionDateTime.isAfter(moment())) {
          return sessionDateTime;
        }
      }
      
      searchDate.add(1, 'day');
    }
    
    return null;
  }

  async isValidSessionDateTime(dateTime, tutorId) {
    // Check if it's a holiday
    if (this.isHoliday(dateTime)) {
      return false;
    }

    // Check if tutor is on leave (would need Leave model)
    // const isOnLeave = await this.isTutorOnLeave(dateTime, tutorId);
    // if (isOnLeave) return false;

    // Check for tutor conflicts
    const hasConflict = await this.hasTutorConflict(dateTime, tutorId);
    if (hasConflict) {
      return false;
    }

    // Check business hours
    const hour = dateTime.hour();
    if (hour < 9 || hour > 21) { // 9 AM to 9 PM
      return false;
    }

    return true;
  }

  isHoliday(dateTime) {
    // Basic holiday check - can be expanded with actual holiday calendar
    const indianHolidays = [
      '01-26', // Republic Day
      '08-15', // Independence Day
      '10-02', // Gandhi Jayanti
    ];
    
    const dateString = dateTime.format('MM-DD');
    return indianHolidays.includes(dateString);
  }

  async hasTutorConflict(dateTime, tutorId) {
    try {
      const { Session } = require('../models');
      const conflictSession = await Session.findOne({
        where: {
          assigned_tutor_id: tutorId,
          scheduled_datetime: {
            [require('sequelize').Op.between]: [
              dateTime.clone().subtract(30, 'minutes').toDate(),
              dateTime.clone().add(90, 'minutes').toDate()
            ]
          },
          status: ['Scheduled', 'Completed']
        }
      });
      
      return !!conflictSession;
    } catch (error) {
      console.error('Conflict check error:', error);
      return true; // Err on the side of caution
    }
  }

  getCurriculumTopic(curriculum, sessionNumber) {
    if (!curriculum || !Array.isArray(curriculum)) {
      return `Session ${sessionNumber}`;
    }
    
    const curriculumItem = curriculum.find(item => item.session === sessionNumber);
    return curriculumItem ? curriculumItem.topic : `Session ${sessionNumber}`;
  }
}

module.exports = SchedulingService;
