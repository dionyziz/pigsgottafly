// Compass deviation cards, transcribed from the compass swing reports.
// Each card: [for (magnetic heading), steer (compass heading)].
(function (root) {
  const AIRCRAFT = {
    'SX-ASV': {
      cards: {
        'Magnetic compass': {
          swung: '2026-02-05', expires: '2028-02-05', source: 'SXASV_COMPASS_SWING_exp20280205.pdf',
          points: [[0, 2], [30, 31], [60, 62], [90, 92], [120, 121], [150, 148],
                   [180, 181], [210, 211], [240, 239], [270, 268], [300, 298], [330, 329]],
        },
      },
    },
    'SX-ASG': {
      cards: {
        'Magnetic compass': {
          swung: '2025-02-06', expires: '2027-02-06', source: 'SXASG_COMPASS_SWING_exp20270206.pdf',
          points: [[0, 1], [30, 32], [60, 62], [90, 93], [120, 122], [150, 152],
                   [180, 181], [210, 212], [240, 241], [270, 272], [300, 303], [330, 331]],
        },
        'GMU (G1000 heading)': {
          swung: '2025-02-06', expires: '2027-02-06', source: 'SXASG_COMPASS_SWING_exp20270206.pdf',
          points: [[0, 0], [30, 30], [60, 59], [90, 89], [120, 120], [150, 150],
                   [180, 179], [210, 210], [240, 242], [270, 271], [300, 300], [330, 330]],
        },
      },
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = AIRCRAFT;
  else root.AIRCRAFT = AIRCRAFT;
})(typeof window !== 'undefined' ? window : globalThis);
