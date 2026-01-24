const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: [true, 'Please add a date for the lesson']
  },
  startTime: {
    type: String, // Format: "HH:mm"
    required: [true, 'Please add a start time']
  },
  lessonType: {
    type: String,
    enum: ['Standard Lesson', 'Highway Logic', 'Parking Mastery', 'Night Driving', 'Test Preparation'],
    default: 'Standard Lesson'
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'confirmed'
  },
  notes: {
    type: String,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Booking', bookingSchema);
