const Booking = require('../models/Booking');

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Private
exports.createBooking = async (req, res) => {
  try {
    const { date, startTime, lessonType, notes } = req.body;

    // Simple validation: Check if slot is taken (in a real app this would be more complex)
    // For now, we just check if the user already has a booking at this time
    const existingBooking = await Booking.findOne({
      user: req.user.id,
      date: date,
      startTime: startTime,
      status: { $ne: 'cancelled' }
    });

    if (existingBooking) {
        return res.status(400).json({
            success: false,
            message: 'You already have a booking at this time'
        });
    }

    const booking = await Booking.create({
      user: req.user.id,
      date,
      startTime,
      lessonType,
      notes
    });

    res.status(201).json({
      success: true,
      data: booking
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Get my bookings
// @route   GET /api/bookings?page=1&limit=10
// @access  Private
exports.getMyBookings = async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await Booking.countDocuments({ user: req.user.id });

    const bookings = await Booking.find({ user: req.user.id })
      .sort({ date: 1, startTime: 1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: bookings
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Cancel booking
// @route   PUT /api/bookings/:id/cancel
// @access  Private
exports.cancelBooking = async (req, res) => {
    try {
        let booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }

        // Make sure user owns booking
        if (booking.user.toString() !== req.user.id) {
            return res.status(401).json({
                success: false,
                message: 'Not authorized to cancel this booking'
            });
        }

        booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, {
            new: true,
            runValidators: true
        });

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};
