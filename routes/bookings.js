const express = require('express');
const { createBooking, getMyBookings, cancelBooking } = require('../controllers/bookingController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect); // All routes are protected

router.route('/')
    .get(getMyBookings)
    .post(createBooking);

router.route('/:id/cancel')
    .put(cancelBooking);

module.exports = router;
