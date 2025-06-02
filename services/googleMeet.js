const { google } = require('googleapis');

class GoogleMeetService {
  constructor() {
    this.auth = new google.auth.GoogleAuth({
      credentials: {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      },
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive'
      ]
    });
    
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
  }

  async createSessionMeeting(session, batch) {
    try {
      const endDateTime = new Date(session.scheduled_datetime);
      endDateTime.setMinutes(endDateTime.getMinutes() + 60); // Default 1 hour

      const event = {
        summary: `${batch.batch_name} - Session ${session.session_number}`,
        description: `Topic: ${session.curriculum_topic || 'TBD'}`,
        start: {
          dateTime: session.scheduled_datetime,
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'Asia/Kolkata'
        },
        conferenceData: {
          createRequest: {
            requestId: session.id,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        // NO attendees to prevent contact sharing
        attendees: []
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1
      });

      return {
        meet_link: response.data.hangoutLink,
        meeting_id: response.data.id
      };
    } catch (error) {
      console.error('Google Meet creation error:', error);
      throw new Error('Failed to create Google Meet link');
    }
  }

  async updateSessionMeeting(sessionId, updates) {
    try {
      const response = await this.calendar.events.patch({
        calendarId: 'primary',
        eventId: sessionId,
        resource: updates
      });
      return response.data;
    } catch (error) {
      console.error('Google Meet update error:', error);
      throw new Error('Failed to update Google Meet');
    }
  }

  async deleteSessionMeeting(meetingId) {
    try {
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId: meetingId
      });
      return true;
    } catch (error) {
      console.error('Google Meet deletion error:', error);
      return false;
    }
  }
}
