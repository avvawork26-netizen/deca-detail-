const EVENT_IDS = {
  sedan: { interior: 5444730, exterior: 5444739, both: 5444743 },
  suv: { interior: 5444744, exterior: 5444752, both: 5444754 },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function buildISODateTime(dateStr, timeStr) {
  const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) throw new Error(`Invalid time format: ${timeStr}`);

  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;

  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');

  // Double-conversion trick: find UTC equivalent of a NY local time
  const localAsUTC = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(localAsUTC);
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  const nyHour = p.hour === '24' ? '00' : p.hour;
  const nyAsUTC = new Date(`${p.year}-${p.month}-${p.day}T${nyHour}:${p.minute}:${p.second}Z`);
  const offsetMs = localAsUTC.getTime() - nyAsUTC.getTime();
  return new Date(localAsUTC.getTime() + offsetMs).toISOString();
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    };
  }

  const { vehicleType, service, wax, name, email, phone, date, time, vehicle, address, notes, serviceType } = body;

  const vehicleIds = EVENT_IDS[vehicleType];
  if (!vehicleIds) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid vehicle type' }),
    };
  }

  const eventTypeId = vehicleIds[service];
  if (!eventTypeId) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid service type' }),
    };
  }

  let isoDateTime;
  try {
    isoDateTime = buildISODateTime(date, time);
  } catch (err) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }

  const payload = {
    start: isoDateTime,
    eventTypeId,
    attendee: {
      name,
      email,
      timeZone: 'America/New_York',
      language: 'en',
    },
    bookingFieldsResponses: {
      phone,
      vehicle,
      serviceType,
      address: address || 'N/A',
      wax: wax ? 'Yes' : 'No',
      notes: notes || 'None',
    },
  };

  try {
    const calResponse = await fetch('https://api.cal.com/v2/bookings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CAL_API_KEY}`,
        'cal-api-version': '2024-08-13',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const calData = await calResponse.json();

    if (!calResponse.ok || (calData.status && calData.status !== 'success')) {
      const errorMessage = calData.error?.message || calData.message || 'Booking failed';
      return {
        statusCode: calResponse.status >= 500 ? 500 : 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: errorMessage }),
      };
    }

    const bookingId = calData.data?.uid || calData.data?.id || calData.uid || calData.id;

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, bookingId }),
    };
  } catch {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to reach booking service' }),
    };
  }
};
