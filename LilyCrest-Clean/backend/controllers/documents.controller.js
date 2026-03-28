const { buildBrandedPdf } = require('../utils/pdfBuilder');

function normalizeLine(line) {
  if (!line) return '';
  return line
    .replace(/•/g, '-')
    .replace(/₱/g, 'PHP ')
    .replace(/✓/g, 'Yes')
    .replace(/[\u2013\u2014]/g, '-')
    .trimEnd();
}

function getDocumentPayload(docId, user) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const userName = user?.name || 'Tenant Name';
  const userEmail = user?.email || 'tenant@example.com';

  const documents = {
    contract: {
      title: 'Lease Contract',
      docType: 'LEASE AGREEMENT',
      subtitle: `Prepared for: ${userName}`,
      date: `Date Issued: ${today}`,
      infoRows: [
        { label: 'Tenant Name', value: userName },
        { label: 'Email Address', value: userEmail },
        { label: 'Date Issued', value: today },
        { label: 'Property', value: 'LilyCrest Gil Puyat, Makati City' },
      ],
      sections: [
        {
          heading: 'Rental Period',
          lines: [
            'Month-to-month; either party may terminate with 30 days written notice.',
          ],
        },
        {
          heading: 'Monthly Rent',
          lines: [
            'Rent due every 5th of the month.',
            'Grace period until the 7th.',
            'Late fee: PHP 50 per day after grace period.',
          ],
        },
        {
          heading: 'Security Deposit',
          lines: [
            'Equivalent to one month rent.',
            'Refundable after move-out inspection.',
            'Damages and unpaid fees may be deducted.',
          ],
        },
        {
          heading: 'Utilities',
          lines: [
            'Water and WiFi included in the monthly rent.',
            'Electricity billed separately based on sub-metered consumption.',
          ],
        },
        {
          heading: 'House Rules',
          lines: [
            'Tenant agrees to comply with all posted LilyCrest house rules.',
            'Violations may result in warnings, fines, or tenancy review.',
          ],
        },
        {
          heading: 'Termination',
          lines: [
            '30-day written notice required from either party.',
            'Early termination may forfeit security deposit.',
          ],
        },
      ],
    },
    valid_id: {
      title: 'Identification Record',
      docType: 'ID VERIFICATION',
      subtitle: `Verification summary for: ${userName}`,
      date: today,
      infoRows: [
        { label: 'Tenant Name', value: userName },
        { label: 'Email', value: userEmail },
        { label: 'Status', value: 'Active Tenant' },
        { label: 'ID Type', value: 'Government-issued ID' },
        { label: 'Verification', value: 'Approved and on file' },
      ],
      sections: [
        {
          heading: 'Notes',
          lines: [
            'Admin office hours: Mon-Sat, 8:00 AM - 5:00 PM.',
            'For a photocopy of the submitted ID, visit the admin office.',
          ],
        },
      ],
    },
    house_rules: {
      title: 'House Rules',
      docType: 'POLICY DOCUMENT',
      date: `Effective as of: ${today}`,
      sections: [
        { heading: 'Quiet Hours', lines: ['10:00 PM - 7:00 AM; keep noise to a minimum and respect neighbors.'] },
        { heading: 'Visitors', lines: [
          'Visiting hours: 8:00 AM - 9:00 PM.',
          'Register with valid ID at the front desk.',
          'Maximum 2 visitors at a time; no overnight guests.',
        ]},
        { heading: 'Curfew', lines: [
          'Main gate closes at 11:00 PM.',
          'Coordinate in advance for late entry.',
          'Late entry fee: PHP 100.',
        ]},
        { heading: 'Cleanliness', lines: [
          'Keep rooms tidy at all times.',
          'No food waste in rooms; report pests immediately.',
          'No pets allowed.',
        ]},
        { heading: 'Prohibited Items', lines: [
          'Cooking appliances in rooms.',
          'Smoking inside the premises.',
          'Illegal substances of any kind.',
        ]},
        { heading: 'Common Areas', lines: [
          'Kitchen hours: 6:00 AM - 10:00 PM.',
          'Clean up after use; label personal food items.',
        ]},
        { heading: 'Payments', lines: [
          'Due on the 5th; grace period until the 7th.',
          'Late fee: PHP 50 per day.',
        ]},
        { heading: 'Violations', lines: ['May incur written warnings, fines, or tenancy review.'] },
      ],
    },
    curfew_policy: {
      title: 'Curfew Policy',
      docType: 'POLICY DOCUMENT',
      date: `Effective as of: ${today}`,
      sections: [
        { heading: 'Gate Hours', lines: ['Main gate closes at 11:00 PM and opens at 5:00 AM.', 'Quiet hours: 10:00 PM - 7:00 AM.'] },
        { heading: 'Late Entry', lines: ['Coordinate before 9:00 PM if expecting to arrive after 11:00 PM.', 'Emergency late entry fee: PHP 100 (waived for documented emergencies).'] },
        { heading: 'Escalation', lines: ['- 1st offense: Verbal warning', '- 2nd offense: Written warning', '- 3rd offense: PHP 500 fine', '- Repeated: Tenancy review'] },
        { heading: 'Exceptions', lines: ['Medical emergencies.', 'Work-related with employer letter.', 'Pre-approved events.'] },
      ],
    },
    visitor_policy: {
      title: 'Visitor Policy',
      docType: 'POLICY DOCUMENT',
      date: `Effective as of: ${today}`,
      sections: [
        { heading: 'Visiting Hours', lines: ['Daily: 8:00 AM - 9:00 PM.'] },
        { heading: 'Registration', lines: ['Valid ID required at the front desk.', 'Tenant must receive visitor in person.', 'Sign in and out required.'] },
        { heading: 'Limits', lines: ['Maximum 2 visitors at a time.', 'No overnight guests permitted.', 'Rooms closed to visitors after 8:00 PM.'] },
        { heading: 'Prohibited', lines: ['- Unregistered visitors', '- Visitors during quiet hours (10 PM - 7 AM)', '- Leaving visitors unattended'] },
        { heading: 'Responsibilities', lines: ['Tenant is liable for visitor behavior and any damages caused.'] },
        { heading: 'Events', lines: ['Request admin approval at least 3 days in advance.'] },
      ],
    },
    payment_terms: {
      title: 'Payment Terms',
      docType: 'PAYMENT POLICY',
      date: `Effective as of: ${today}`,
      sections: [
        { heading: 'Due Dates', lines: ['5th of each month; grace period through the 7th.', 'Late fee: PHP 50/day after grace; maximum PHP 1,500/month.'] },
        { heading: 'Accepted Payment Methods', lines: [
          '- Bank Transfer: BDO 1234-5678-9012 / BPI 9876-5432-1098',
          '- Account Name: LilyCrest Properties Inc.',
          '- E-Wallet: GCash/Maya 0912 345 6789',
          '- Cash: Admin office Mon-Sat 8 AM - 5 PM',
          '- Online: PayMongo (GCash, Maya, Card) via the app',
        ]},
        { heading: 'Important Notes', lines: [
          'Always upload proof of payment in the app.',
          'Verification takes 24-48 hours.',
        ]},
        { heading: 'Utilities', lines: ['Water and WiFi included.', 'Electricity billed separately (sub-metered).'] },
        { heading: 'Non-Payment Escalation', lines: ['- 15 days: Final notice', '- 30 days: Service restriction', '- 45 days: Tenancy review'] },
      ],
    },
    emergency_procedures: {
      title: 'Emergency Procedures',
      docType: 'SAFETY DOCUMENT',
      date: `Effective as of: ${today}`,
      sections: [
        { heading: 'Emergency Contacts', lines: [
          '- Admin: +63 912 345 6789',
          '- Security: Available 24/7 on-site',
          '- Emergency Hotline: +63 912 345 6790',
        ]},
        { heading: 'Fire', lines: ['Sound the alarm immediately.', 'Avoid elevators; use emergency exits.', 'Assembly point: Parking lot.', 'Call 911.'] },
        { heading: 'Earthquake', lines: ['Drop, cover, and hold on.', 'Stay away from windows.', 'Evacuate if structural damage is visible.', 'Meet at the assembly point.'] },
        { heading: 'Medical Emergency', lines: ['Call building security immediately.', 'Do not move the injured person.', 'Admin will coordinate ambulance dispatch.'] },
        { heading: 'Nearby Hospitals', lines: ['- Makati Medical Center (~2km)', '- Ospital ng Makati (~1.5km)'] },
        { heading: 'Safety Equipment', lines: ['Fire extinguishers: Hallways, kitchen, lobby.'] },
      ],
    },
  };

  return documents[docId] || null;
}

function downloadDocument(req, res) {
  const docId = req.params.docId || 'contract';
  const payload = getDocumentPayload(docId, req.user);

  if (!payload) {
    return res.status(404).json({ detail: 'Document not found' });
  }

  // Map sections lines through normalizeLine
  const normalizedSections = (payload.sections || []).map(s => ({
    heading: s.heading,
    lines: (s.lines || []).map(normalizeLine),
  }));

  const normalizedInfoRows = (payload.infoRows || []).map(r => ({
    label: r.label,
    value: normalizeLine(r.value),
  }));

  const pdfBuffer = buildBrandedPdf({
    title: payload.title,
    subtitle: payload.subtitle || '',
    docType: payload.docType || '',
    date: payload.date || '',
    infoRows: normalizedInfoRows,
    sections: normalizedSections,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${docId}.pdf"`);
  res.send(pdfBuffer);
}

module.exports = {
  downloadDocument,
};