
const loadBtn = document.getElementById('loadBtn');

const statusSpan = document.getElementById('status');

const milestonesDiv = document.getElementById('milestones');

const deliverablesDiv = document.getElementById('deliverables');

const paymentsDiv = document.getElementById('payments');

const configDiv = document.getElementById('config');

const API_BASE = '/.netlify/functions/proxy';

async function fetchData(type) {

try {

statusSpan.textContent = `Loading ${type} data...`;

const response = await fetch(`${API_BASE}?type=${type}`);

if (!response.ok) {

const errorText = await response.text();

throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);

}

const data = await response.json();

statusSpan.textContent = `Successfully loaded ${type}.`;

return data;

} catch (error) {

console.error(`Error fetching ${type}:`, error);

statusSpan.textContent = `Error loading ${type}: ${error.message}`;

return null;

}

}

function renderConfig(data) {

if (!data || !data.results || data.results.length === 0) {

configDiv.innerHTML = '<p>No project configuration found.</p>';

return;

}

let html = '<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>';

data.results.forEach(item => {

const key = [item.properties](http://item.properties).Key?.title?.[0]?.plain_text ?? 'N/A';

const value = [item.properties](http://item.properties).Value?.rich_text?.[0]?.plain_text ?? 'N/A';

html += `<tr><td>${key}</td><td>${value}</td></tr>`;

});

html += '</tbody></table>';

configDiv.innerHTML = html;

}

function renderMilestones(data) {

if (!data || !data.results || data.results.length === 0) {

milestonesDiv.innerHTML = '<p>No project milestones found.</p>';

return;

}

let html = '<table><thead><tr><th>Title</th><th>Phase</th><th>Status</th><th>Paid vs Budget (%)</th></tr></thead><tbody>';

data.results.forEach(item => {

const title = [item.properties](http://item.properties).MilestoneTitle?.title?.[0]?.plain_text ?? 'N/A';

const phase = [item.properties](http://item.properties).Phase?.select?.name ?? 'N/A';

const status = [item.properties](http://item.properties).Status?.select?.name ?? 'N/A';

const paidVsBudgetRaw = [item.properties](http://item.properties)['Paid vs Budget (%)']?.formula?.number;

const paidVsBudget = (paidVsBudgetRaw ?? null) !== null ? `${(paidVsBudgetRaw * 100).toFixed(2)}%` : 'N/A';

html += `<tr><td>${title}</td><td>${phase}</td><td>${status}</td><td>${paidVsBudget}</td></tr>`;

});

html += '</tbody></table>';

milestonesDiv.innerHTML = html;

}

function renderDeliverables(data) {

if (!data || !data.results || data.results.length === 0) {

deliverablesDiv.innerHTML = '<p>No gate deliverables found.</p>';

return;

}

let html = '<table><thead><tr><th>Deliverable Name</th><th>Gate</th><th>Status</th></tr></thead><tbody>';

data.results.forEach(item => {

const name = [item.properties](http://item.properties)['Deliverable Name']?.title?.[0]?.plain_text ?? 'N/A';

const gate = [item.properties](http://item.properties).Gate?.select?.name ?? 'N/A';

const status = [item.properties](http://item.properties).Status?.select?.name ?? 'N/A';

html += `<tr><td>${name}</td><td>${gate}</td><td>${status}</td></tr>`;

});

html += '</tbody></table>';

deliverablesDiv.innerHTML = html;

}

function renderPayments(data) {

if (!data || !data.results || data.results.length === 0) {

paymentsDiv.innerHTML = '<p>No payment schedule found.</p>';

return;

}

let html = '<table><thead><tr><th>Payment For</th><th>Status</th><th>Amount (RM)</th><th>Due Date</th></tr></thead><tbody>';

data.results.forEach(item => {

const paymentFor = [item.properties](http://item.properties)['Payment For']?.title?.[0]?.plain_text ?? 'N/A';

const status = [item.properties](http://item.properties).Status?.select?.name ?? 'N/A';

const amountRaw = [item.properties](http://item.properties)['Amount (RM)']?.number;

const amount = (amountRaw ?? null) !== null ? amountRaw.toFixed(2) : 'N/A';

const dueDate = [item.properties](http://item.properties).DueDate?.date?.start ? new Date([item.properties.DueDate.date](http://item.properties.DueDate.date).start).toLocaleDateString() : 'N/A';

html += `<tr><td>${paymentFor}</td><td>${status}</td><td>${amount}</td><td>${dueDate}</td></tr>`;

});

html += '</tbody></table>';

paymentsDiv.innerHTML = html;

}

async function loadAllData() {

statusSpan.textContent = 'Loading all dashboard data... Please wait.';

loadBtn.disabled = true;

try {

const [configData, milestonesData, deliverablesData, paymentsData] = await Promise.all([

fetchData('config'),

fetchData('milestones'),

fetchData('deliverables'),

fetchData('payments')

]);

renderConfig(configData);

renderMilestones(milestonesData);

renderDeliverables(deliverablesData);

renderPayments(paymentsData);

statusSpan.textContent = 'All dashboard data loaded successfully!';

} catch (error) {

console.error('Error in loadAllData:', error);

statusSpan.textContent = `Failed to load all data: ${error.message}`;

} finally {

loadBtn.disabled = false;

}

}

loadBtn.addEventListener('click', loadAllData);

// document.addEventListener('DOMContentLoaded', loadAllData);

