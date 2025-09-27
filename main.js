// main.js

// Get references to the HTML elements
const loadBtn = document.getElementById('loadBtn');
const statusSpan = document.getElementById('status');
const milestonesDiv = document.getElementById('milestones');
const deliverablesDiv = document.getElementById('deliverables');
const paymentsDiv = document.getElementById('payments');
const configDiv = document.getElementById('config');

// Base path for your Netlify Function
const API_BASE = '/.netlify/functions/proxy';

/**
 * Fetches data for a specific type from the Netlify Function.
 * @param {string} type - The type of data to fetch (e.g., 'milestones', 'config').
 * @returns {Promise<object|null>} - The fetched JSON data or null on error.
 */
async function fetchData(type) {
    try {
        statusSpan.textContent = `Loading ${type} data...`;
        const response = await fetch(`${API_BASE}?type=${type}`);

        if (!response.ok) {
            const errorText = await response.text(); // Get raw error response for more info
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

/**
 * Renders the Project Configuration data into the configDiv.
 * @param {object} data - The Notion API response for config.
 */
function renderConfig(data) {
    if (!data || !data.results || data.results.length === 0) {
        configDiv.innerHTML = '<p>No project configuration found.</p>';
        return;
    }
    let html = '<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
    data.results.forEach(item => {
        const key = item.properties.Key?.title[0]?.plain_text || 'N/A';
        const value = item.properties.Value?.rich_text[0]?.plain_text || 'N/A';
        html += `<tr><td>${key}</td><td>${value}</td></tr>`;
    });
    html += '</tbody></table>';
    configDiv.innerHTML = html;
}

/**
 * Renders the Project Milestones data into the milestonesDiv.
 * @param {object} data - The Notion API response for milestones.
 */
function renderMilestones(data) {
    if (!data || !data.results || data.results.length === 0) {
        milestonesDiv.innerHTML = '<p>No project milestones found.</p>';
        return;
    }
    let html = '<table><thead><tr><th>Title</th><th>Phase</th><th>Status</th><th>Paid vs Budget (%)</th></tr></thead><tbody>';
    data.results.forEach(item => {
        const title = item.properties.MilestoneTitle?.title[0]?.plain_text || 'N/A';
        const phase = item.properties.Phase?.select?.name || 'N/A';
        const status = item.properties.Status?.select?.name || 'N/A';
        const paidVsBudgetRaw = item.properties['Paid vs Budget (%)']?.formula?.number;
        const paidVsBudget = paidVsBudgetRaw !== undefined && paidVsBudgetRaw !== null ?
                             `${(paidVsBudgetRaw * 100).toFixed(2)}%` : 'N/A';

        html += `<tr><td>${title}</td><td>${phase}</td><td>${status}</td><td>${paidVsBudget}</td></tr>`;
    });
    html += '</tbody></table>';
    milestonesDiv.innerHTML = html;
}

/**
 * Renders the Gate Deliverables data into the deliverablesDiv.
 * @param {object} data - The Notion API response for deliverables.
 */
function renderDeliverables(data) {
    if (!data || !data.results || data.results.length === 0) {
        deliverablesDiv.innerHTML = '<p>No gate deliverables found.</p>';
        return;
    }
    let html = '<table><thead><tr><th>Deliverable Name</th><th>Gate</th><th>Status</th></tr></thead><tbody>';
    data.results.forEach(item => {
        const name = item.properties['Deliverable Name']?.title[0]?.plain_text || 'N/A';
        const gate = item.properties.Gate?.select?.name || 'N/A';
        const status = item.properties.Status?.select?.name || 'N/A';
        html += `<tr><td>${name}</td><td>${gate}</td><td>${status}</td></tr>`;
    });
    html += '</tbody></table>';
}

/**
 * Renders the Payment Schedule data into the paymentsDiv.
 * @param {object} data - The Notion API response for payments.
 */
function renderPayments(data) {
    if (!data || !data.results || data.results.length === 0) {
        paymentsDiv.innerHTML = '<p>No payment schedule found.</p>';
        return;
    }
    let html = '<table><thead><tr><th>Payment For</th><th>Status</th><th>Amount (RM)</th><th>Due Date</th></tr></thead><tbody>';
    data.results.forEach(item => {
        const paymentFor = item.properties['Payment For']?.title[0]?.plain_text || 'N/A';
        const status = item.properties.Status?.select?.name || 'N/A';
        const amountRaw = item.properties['Amount (RM)']?.number;
        const amount = amountRaw !== undefined && amountRaw !== null ? amountRaw.toFixed(2) : 'N/A';
        const dueDate = item.properties.DueDate?.date?.start ? new Date(item.properties.DueDate.date.start).toLocaleDateString() : 'N/A';
        html += `<tr><td>${paymentFor}</td><td>${status}</td><td>${amount}</td><td>${dueDate}</td></tr>`;
    });
    html += '</tbody></table>';
}

/**
 * Orchestrates fetching and rendering all types of data concurrently.
 */
async function loadAllData() {
    statusSpan.textContent = 'Loading all dashboard data... Please wait.';
    loadBtn.disabled = true; // Disable button while loading

    try {
        // Fetch all data types in parallel
        const [configData, milestonesData, deliverablesData, paymentsData] = await Promise.all([
            fetchData('config'),
            fetchData('milestones'),
            fetchData('deliverables'),
            fetchData('payments')
        ]);

        // Render each section with its respective data
        renderConfig(configData);
        renderMilestones(milestonesData);
        renderDeliverables(deliverablesData);
        renderPayments(paymentsData);

        statusSpan.textContent = 'All dashboard data loaded successfully!';
    } catch (error) {
        console.error('Error in loadAllData:', error);
        statusSpan.textContent = `Failed to load all data: ${error.message}`;
    } finally {
        loadBtn.disabled = false; // Re-enable button
    }
}

// Add event listener to the "Load All Data" button
loadBtn.addEventListener('click', loadAllData);

// Optional: Automatically load data when the page finishes loading
// Uncomment the line below if you want this behavior
// document.addEventListener('DOMContentLoaded', loadAllData);