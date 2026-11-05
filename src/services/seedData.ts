export const SEED_USERS = [
  { id: 1, username: 'nusrat.jahan', full_name: 'Nusrat Jahan', email: 'nusrat@bondhufund.org', role: 'Treasurer', avatar_initials: 'NJ', status: 'Active' },
  { id: 2, username: 'admin', full_name: 'System Admin', email: 'admin@bondhufund.org', role: 'Admin', avatar_initials: 'AD', status: 'Active' },
  { id: 3, username: 'tariqul.islam', full_name: 'Tariqul Islam', email: 'tariqul@bondhufund.org', role: 'Auditor', avatar_initials: 'TI', status: 'Active' },
  { id: 4, username: 'farhana.y', full_name: 'Farhana Yasmin', email: 'farhana@bondhufund.org', role: 'Manager', avatar_initials: 'FY', status: 'Active' }
];

export const SEED_MASTER_CATEGORIES = [
  // Expense categories
  { type: 'expense_category', name: 'Meetup & Events', description: 'Monthly union meetings, social events, venue booking', is_active: 1 },
  { type: 'expense_category', name: 'Office Supplies', description: 'Stationery, register books, stamps', is_active: 1 },
  { type: 'expense_category', name: 'Legal & Documentation', description: 'Deed registration, stamp fees, notary', is_active: 1 },
  { type: 'expense_category', name: 'Committee Refreshments', description: 'Snacks and tea for committee meetings', is_active: 1 },
  { type: 'expense_category', name: 'Maintenance', description: 'Asset repairs, servicing of generator and shared tools', is_active: 1 },
  { type: 'expense_category', name: 'Bank Charges & SMS', description: 'Account maintenance fees, SMS notification bundle', is_active: 1 },

  // Investment sectors
  { type: 'investment_sector', name: 'Land purchase', description: 'Plots and agricultural or commercial land shares', is_active: 1 },
  { type: 'investment_sector', name: 'Flat purchase', description: 'Apartment shares and residential real estate', is_active: 1 },
  { type: 'investment_sector', name: 'Plot purchase', description: 'Suburban development plot shares', is_active: 1 },
  { type: 'investment_sector', name: 'Assets', description: 'Machinery, generators, and rentable equipment', is_active: 1 },

  // Payment methods
  { type: 'payment_method', name: 'Bank transfer', description: 'Direct bank deposit / BEFTN / NPSB', is_active: 1 },
  { type: 'payment_method', name: 'Cash', description: 'Physical cash received by treasurer', is_active: 1 },
  { type: 'payment_method', name: 'bKash', description: 'bKash merchant or personal transfer', is_active: 1 },
  { type: 'payment_method', name: 'Nagad', description: 'Nagad mobile wallet payment', is_active: 1 },
  { type: 'payment_method', name: 'Rocket', description: 'Dutch-Bangla Rocket mobile banking', is_active: 1 },
  { type: 'payment_method', name: 'Cheque', description: 'Account payee bank cheque', is_active: 1 },
];

export const SEED_INVESTMENTS = [
  {
    name: 'Green Valley Land',
    sector: 'Land purchase',
    purchase_date: '12 Jan 2024',
    invested_amount: 386400,
    current_estimated_value: 452000,
    gain_loss: 65600,
    status: 'Growing',
    review_date: '15 Jul 2024',
    location_details: 'Keraniganj Mouza, Dag 402/1',
    notes: 'Boundary wall completed. Registration deed verified by legal advisor.'
  },
  {
    name: 'Lakeview Flat Share',
    sector: 'Flat purchase',
    purchase_date: '04 Mar 2024',
    invested_amount: 285200,
    current_estimated_value: 309000,
    gain_loss: 23800,
    status: 'Growing',
    review_date: '10 Aug 2024',
    location_details: 'Banasree Block C, 5th Floor unit share',
    notes: 'Under construction (8th slab completed). Handover in Q4 2025.'
  },
  {
    name: 'Uttara Plot 7B',
    sector: 'Plot purchase',
    purchase_date: '19 Apr 2024',
    invested_amount: 165600,
    current_estimated_value: 201000,
    gain_loss: 35400,
    status: 'Review',
    review_date: '28 June 2024',
    location_details: 'Sector 18, Road 4, Plot 7B',
    notes: 'Committee review scheduled for 28 June 2024 to verify mutation papers.'
  },
  {
    name: 'Community generator',
    sector: 'Assets',
    purchase_date: '02 Feb 2024',
    invested_amount: 82800,
    current_estimated_value: 114000,
    gain_loss: 31200,
    status: 'Growing',
    review_date: '05 Sep 2024',
    location_details: 'Central Society Warehouse',
    notes: 'Commercial 15kVA silent diesel generator yielding rental income.'
  }
];

export const SEED_EXPENSES = [
  {
    title: 'June meetup expense',
    category: 'Meetup & Events',
    amount: 6800,
    expense_date: '28 Jun 2024',
    payee: 'Rafiq Hasan',
    receipt_ref: 'RCP-240628-09',
    status: 'Needs receipt',
    notes: 'Hall rental and evening snacks for bi-monthly progress discussion.'
  },
  {
    title: 'Legal verification stamp paper',
    category: 'Legal & Documentation',
    amount: 4500,
    expense_date: '15 Jun 2024',
    payee: 'Advocate Shamsul Haq',
    receipt_ref: 'RCP-240615-02',
    status: 'Verified',
    notes: 'Stamp paper and notary fees for Uttara plot registration verification.'
  },
  {
    title: 'Office register & stationery',
    category: 'Office Supplies',
    amount: 1450,
    expense_date: '05 Jun 2024',
    payee: 'Al-Madina Stationery',
    receipt_ref: 'RCP-240605-01',
    status: 'Verified',
    notes: 'Member receipt books, carbon duplicate pads, ledger book.'
  },
  {
    title: 'Generator servicing & oil change',
    category: 'Maintenance',
    amount: 3200,
    expense_date: '20 May 2024',
    payee: 'Bengal Power Tech',
    receipt_ref: 'RCP-240520-04',
    status: 'Verified',
    notes: 'Routine 250-hour servicing and mobil filter replacement.'
  }
];

// Helper to generate the exact 48 members with the 6 visible mockup members at top
export function generateSeedMembers() {
  const primaryMembers = [
    { code: 'BF-0012', name: 'Mim Akter', initials: 'MA', phone: '01711-234567', email: 'mim.akter@gmail.com', status: 'Paid', contributed: 48000, lastPay: '28 Jun 2024', due: 2000, lateFee: 0 },
    { code: 'BF-0021', name: 'Arif Hossain', initials: 'AH', phone: '01819-345678', email: 'arif.hossain@gmail.com', status: 'Paid', contributed: 42000, lastPay: '12 Jun 2024', due: 2000, lateFee: 0 },
    { code: 'BF-0009', name: 'Sadia Rahman', initials: 'SR', phone: '01912-456789', email: 'sadia.rahman@gmail.com', status: 'Paid', contributed: 50000, lastPay: '22 Jun 2024', due: 2000, lateFee: 300 },
    { code: 'BF-0034', name: 'Rafiq Hasan', initials: 'RH', phone: '01678-567890', email: 'rafiq.hasan@gmail.com', status: 'Overdue', contributed: 36000, lastPay: '02 May 2024', due: 2000, lateFee: 300 },
    { code: 'BF-0017', name: 'Jannatul Ferdous', initials: 'JF', phone: '01552-678901', email: 'jannatul.f@gmail.com', status: 'Pending', contributed: 44000, lastPay: '18 Jun 2024', due: 2000, lateFee: 0 },
    { code: 'BF-0040', name: 'Tanvir Ahmed', initials: 'TA', phone: '01733-789012', email: 'tanvir.ahmed@gmail.com', status: 'Paid', contributed: 28000, lastPay: '05 Jun 2024', due: 2000, lateFee: 0 },
  ];

  const additionalNames = [
    { name: 'Kawsar Mahmud', initials: 'KM' },
    { name: 'Nasrin Sultana', initials: 'NS' },
    { name: 'Mahbubur Rahman', initials: 'MR' },
    { name: 'Shirin Akter', initials: 'SA' },
    { name: 'Kamal Uddin', initials: 'KU' },
    { name: 'Farzana Haque', initials: 'FH' },
    { name: 'Zahid Hasan', initials: 'ZH' },
    { name: 'Salma Begum', initials: 'SB' },
    { name: 'Mizanur Rahman', initials: 'MR' },
    { name: 'Rumana Islam', initials: 'RI' },
    { name: 'Anowar Hossain', initials: 'AH' },
    { name: 'Nazma Khatun', initials: 'NK' },
    { name: 'Belal Hossain', initials: 'BH' },
    { name: 'Hasina Akter', initials: 'HA' },
    { name: 'Sohag Mia', initials: 'SM' },
    { name: 'Rina Parvin', initials: 'RP' },
    { name: 'Shahidul Islam', initials: 'SI' },
    { name: 'Jesmin Ara', initials: 'JA' },
    { name: 'Habibur Rahman', initials: 'HR' },
    { name: 'Monira Begum', initials: 'MB' },
    { name: 'Tarek Aziz', initials: 'TA' },
    { name: 'Sultana Razia', initials: 'SR' },
    { name: 'Golam Kibria', initials: 'GK' },
    { name: 'Fahmida Khanom', initials: 'FK' },
    { name: 'Delowar Hossain', initials: 'DH' },
    { name: 'Shamima Nasrin', initials: 'SN' },
    { name: 'Azizul Haque', initials: 'AH' },
    { name: 'Khaleda Akter', initials: 'KA' },
    { name: 'Mustafizur Rahman', initials: 'MR' },
    { name: 'Shahana Parvin', initials: 'SP' },
    { name: 'Abdur Rashid', initials: 'AR' },
    { name: 'Laila Arjumand', initials: 'LA' },
    { name: 'Ashraful Alam', initials: 'AA' },
    { name: 'Kohinur Begum', initials: 'KB' },
    { name: 'Motiur Rahman', initials: 'MR' },
    { name: 'Rehana Sultana', initials: 'RS' },
    { name: 'Babul Chandra', initials: 'BC' },
    { name: 'Taslima Nasrin', initials: 'TN' },
    { name: 'Saiful Islam', initials: 'SI' },
    { name: 'Sabina Yasmin', initials: 'SY' },
    { name: 'Enamul Haque', initials: 'EH' },
    { name: 'Rokeya Begum', initials: 'RB' },
  ];

  // We need 48 total: 42 Paid, 3 Pending, 3 Overdue
  // In primary: 4 Paid (Mim, Arif, Sadia, Tanvir), 1 Pending (Jannatul), 1 Overdue (Rafiq)
  // Remaining 42: need 38 Paid, 2 Pending, 2 Overdue.
  const members = [...primaryMembers];
  const usedCodes = new Set(primaryMembers.map(m => m.code));

  let nextNum = 1;
  additionalNames.forEach((item, index) => {
    while (usedCodes.has(`BF-${String(nextNum).padStart(4, '0')}`)) {
      nextNum++;
    }
    const code = `BF-${String(nextNum).padStart(4, '0')}`;
    usedCodes.add(code);
    nextNum++;

    let status = 'Paid';
    let lastPay = `${Math.min(25, (index % 20) + 1)} Jun 2024`;
    let lateFee = 0;

    if (index === 0 || index === 1) {
      status = 'Pending';
      lastPay = '10 May 2024';
    } else if (index === 2 || index === 3) {
      status = 'Overdue';
      lastPay = '15 Apr 2024';
      lateFee = 300;
    } else if (index % 8 === 0) {
      lateFee = 300; // a few paid with late fee
    }

    const contributed = 20000 + (index * 1000);

    members.push({
      code,
      name: item.name,
      initials: item.initials,
      phone: `017${(10 + index % 80).toString()}-${(100000 + index * 1234).toString().slice(0, 6)}`,
      email: `${item.name.toLowerCase().replace(/\s+/g, '.')}${index}@bondhufund.org`,
      status,
      contributed,
      lastPay,
      due: 2000,
      lateFee,
    });
  });

  return members;
}

