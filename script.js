// ============ FIREBASE CONFIGURATION ============
// Replace this with your Firebase config from the Firebase console
const firebaseConfig = {
 apiKey: "AIzaSyBZo_FFdU2CSumLqgNI8NVaFDTVasviLiw",
  authDomain: "budgeting-app-729c4.firebaseapp.com",
  projectId: "budgeting-app-729c4",
  storageBucket: "budgeting-app-729c4.firebasestorage.app",
  messagingSenderId: "726012098355",
  appId: "1:726012098355:web:41c4b2954e0560bcf13046",
  measurementId: "G-0QP5PECGDP"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// ============ STATE ============
let state = {
    months: {}
};

let currentMonth = new Date();
const MONTH_KEY = () => getMonthKey(currentMonth);
let isSyncing = false;
let isLoaded = false;
let currentUser = null;

// Copy Budget Pagination
let copyBudgetCurrentPage = 0;
const COPY_BUDGET_MONTHS_PER_PAGE = 3;
let copyBudgetAllMonths = [];

// ============ CALCULATOR HELPERS ============
function evaluateExpression(expr) {
    if (!expr || expr.trim() === '') return null;
    
    let clean = expr.replace(/\s/g, '');
    
    if (!/^[\d+\-.*\/]+$/.test(clean)) {
        return null;
    }
    
    try {
        clean = clean.replace(/\+{2,}/g, '+');
        clean = clean.replace(/\-{2,}/g, '-');
        clean = clean.replace(/\+\-/g, '-');
        clean = clean.replace(/\-\+/g, '-');
        
        if (clean.startsWith('-')) {
            clean = '0' + clean;
        }
        
        const tokens = clean.match(/(?:\+|\-)?[\d.]+/g);
        if (!tokens) return null;
        
        let result = 0;
        for (let token of tokens) {
            result += parseFloat(token);
        }
        
        if (isNaN(result) || !isFinite(result)) return null;
        return Math.round(result * 100) / 100;
    } catch (e) {
        return null;
    }
}

function setupCalculatorInput(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    
    if (!input) return;
    
    input.addEventListener('input', function() {
        const val = this.value.trim();
        if (!val) {
            preview.style.display = 'none';
            return;
        }
        
        if (!val.includes('+') && !val.includes('-')) {
            preview.style.display = 'none';
            return;
        }
        
        const result = evaluateExpression(val);
        if (result !== null) {
            preview.textContent = `= ₹${result.toFixed(2)}`;
            preview.style.display = 'block';
            preview.style.color = '#10b981';
        } else {
            preview.textContent = '⚠️ Invalid expression';
            preview.style.display = 'block';
            preview.style.color = '#ef4444';
        }
    });
}

// ============ AUTHENTICATION ============
function initAuth() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            document.getElementById('loginScreen').style.display = 'none';
            await loadUserData(user.uid);
            showApp();
        } else {
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('appContainer').style.display = 'none';
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    });
}

function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .catch((error) => {
            const errorEl = document.getElementById('authError');
            errorEl.textContent = 'Sign in failed: ' + error.message;
            errorEl.style.display = 'block';
        });
}

function signOut() {
    auth.signOut().then(() => {
        currentUser = null;
        state = { months: {} };
        document.getElementById('appContainer').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        showNotification('Signed out successfully', 'info');
    });
}

// ============ FIREBASE DATA FUNCTIONS ============
async function loadUserData(userId) {
    const statusEl = document.getElementById('loadingStatus');
    const progressBar = document.getElementById('loadingProgress');
    
    try {
        statusEl.textContent = 'Loading your data...';
        progressBar.style.width = '30%';
        
        const docRef = db.collection('users').doc(userId);
        const doc = await docRef.get();
        
        progressBar.style.width = '70%';
        statusEl.textContent = 'Processing data...';
        
        if (doc.exists) {
            const serverData = doc.data();
            if (serverData && serverData.data) {
                state = serverData.data;
                ensureStateStructure();
            } else {
                initializeEmptyState();
            }
        } else {
            initializeEmptyState();
            await saveToFirebase(userId);
        }
        
        progressBar.style.width = '100%';
        statusEl.textContent = 'Ready!';
        isLoaded = true;
        
    } catch (error) {
        console.error('Load error:', error);
        statusEl.textContent = '❌ Failed to load data: ' + error.message;
        progressBar.style.background = '#ef4444';
        throw error;
    }
}

function ensureStateStructure() {
    if (!state.months) state.months = {};
    for (const key in state.months) {
        const month = state.months[key];
        if (!month.recordDate) {
            const date = new Date(key + '-01');
            month.recordDate = date.toISOString().split('T')[0];
        }
        if (!month.note) month.note = '';
        if (!month.budgets) month.budgets = {};
        if (!month.expenses) month.expenses = [];
        if (!month.categories) month.categories = [];
    }
}

function initializeEmptyState() {
    state.months = {};
    const key = MONTH_KEY();
    const date = new Date();
    state.months[key] = {
        bank: 0,
        cash: 0,
        recordDate: date.toISOString().split('T')[0],
        note: '',
        budgets: {},
        expenses: [],
        categories: ['Groceries', 'Rent', 'Utilities', 'Transportation', 'Dining', 'Shopping', 'Entertainment', 'Healthcare', 'Insurance', 'Other']
    };
}

async function saveToFirebase(userId) {
    const user = userId || (currentUser ? currentUser.uid : null);
    if (!user) return;
    
    const docRef = db.collection('users').doc(user);
    await docRef.set({
        data: state,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

async function syncData() {
    if (isSyncing || !currentUser) return;
    
    const statusEl = document.getElementById('syncStatus');
    statusEl.textContent = '⏳ Syncing...';
    statusEl.style.color = '#f59e0b';
    statusEl.style.background = '#fef3c7';
    isSyncing = true;
    
    try {
        await saveToFirebase(currentUser.uid);
        statusEl.textContent = '☁️ Synced';
        statusEl.style.color = '#10b981';
        statusEl.style.background = '#d1fae5';
        showNotification('✅ Data synced successfully!', 'success');
    } catch (error) {
        console.error('Sync error:', error);
        statusEl.textContent = '⚠️ Sync failed';
        statusEl.style.color = '#ef4444';
        statusEl.style.background = '#fee2e2';
        showNotification('❌ Sync failed: ' + error.message, 'error');
    }
    
    isSyncing = false;
}

// ============ SHOW APP ============
function showApp() {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    
    setupCalculatorInput('snapshotBank', 'bankPreview');
    setupCalculatorInput('snapshotCash', 'cashPreview');
    setupCalculatorInput('expenseAmount', 'expensePreview');
    
    document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('snapshotRecordDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('snapshotModal').addEventListener('click', function(e) {
        if (e.target === this) closeModal('snapshotModal');
    });
    
    renderMonth();
    renderAll();
    populateBudgetInputs();
    
    const statusEl = document.getElementById('syncStatus');
    statusEl.textContent = '☁️ Synced';
    statusEl.style.color = '#10b981';
    statusEl.style.background = '#d1fae5';
}

// ============ DATA PERSISTENCE ============
function saveData() {
    if (isLoaded && currentUser) {
        saveToFirebase(currentUser.uid).catch(err => {
            console.error('Save to Firebase failed:', err);
            const statusEl = document.getElementById('syncStatus');
            statusEl.textContent = '⚠️ Offline';
            statusEl.style.color = '#ef4444';
            statusEl.style.background = '#fee2e2';
        });
    }
}

function getMonthKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthCategories(monthKey) {
    const key = monthKey || MONTH_KEY();
    const data = getMonthData(key);
    return data.categories || [];
}

function getMonthData(monthKey) {
    const key = monthKey || MONTH_KEY();
    if (!state.months[key]) {
        const date = new Date(key + '-01');
        state.months[key] = {
            bank: 0,
            cash: 0,
            recordDate: date.toISOString().split('T')[0],
            note: '',
            budgets: {},
            expenses: [],
            categories: []
        };
        saveData();
    }
    return state.months[key];
}

function getPreviousMonthKey() {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() - 1);
    return getMonthKey(d);
}

function getAvailablePastMonths() {
    const currentKey = MONTH_KEY();
    const available = [];
    
    for (const key in state.months) {
        if (key < currentKey) {
            const monthData = state.months[key];
            const hasBudgets = monthData.budgets && Object.keys(monthData.budgets).length > 0;
            const hasCategories = monthData.categories && monthData.categories.length > 0;
            if (hasBudgets || hasCategories) {
                available.push({
                    key: key,
                    budgetCount: Object.keys(monthData.budgets || {}).length,
                    categoryCount: (monthData.categories || []).length
                });
            }
        }
    }
    
    available.sort((a, b) => b.key.localeCompare(a.key));
    return available;
}

// ============ MONTH NAVIGATION ============
function changeMonth(delta) {
    currentMonth.setMonth(currentMonth.getMonth() + delta);
    renderMonth();
    renderAll();
}

function goToToday() {
    currentMonth = new Date();
    renderMonth();
    renderAll();
}

function renderMonth() {
    const options = { year: 'numeric', month: 'long' };
    document.getElementById('currentMonth').textContent =
        currentMonth.toLocaleDateString('en-US', options);

    document.getElementById('snapshotMonth').textContent =
        currentMonth.toLocaleDateString('en-US', options);
    document.getElementById('budgetMonth').textContent =
        currentMonth.toLocaleDateString('en-US', options);
    document.getElementById('copyTargetMonth').textContent =
        currentMonth.toLocaleDateString('en-US', options);
}

// ============ RENDER ALL ============
function renderAll() {
    renderSnapshot();
    renderBudgetOverview();
    renderCategoryChart();
    renderRecentExpenses();
    renderExpenses();
    renderCategoryList();
    populateCategorySelect();
    populateBudgetInputs();
}

// ============ SNAPSHOT ============
function renderSnapshot() {
    const currentKey = MONTH_KEY();
    const prevKey = getPreviousMonthKey();
    
    const currentData = getMonthData(currentKey);
    const prevData = state.months[prevKey];
    
    const currentBank = currentData.bank || 0;
    const currentCash = currentData.cash || 0;
    const currentTotal = currentBank + currentCash;
    
    const prevBank = prevData ? prevData.bank || 0 : 0;
    const prevCash = prevData ? prevData.cash || 0 : 0;
    const prevTotal = prevBank + prevCash;

    document.getElementById('bankBalance').textContent = formatCurrency(currentBank);
    document.getElementById('cashBalance').textContent = formatCurrency(currentCash);
    document.getElementById('totalBalance').textContent = formatCurrency(currentTotal);

    updateChangeIndicator('bankChange', currentBank, prevBank);
    updateChangeIndicator('cashChange', currentCash, prevCash);
    updateChangeIndicator('totalChange', currentTotal, prevTotal);

    const infoDiv = document.getElementById('snapshotInfo');
    const dateTextEl = document.getElementById('snapshotDateText');
    
    if (currentData.bank > 0 || currentData.cash > 0) {
        infoDiv.style.display = 'block';
        const recordDate = currentData.recordDate || new Date().toISOString().split('T')[0];
        const formattedDate = formatDate(recordDate);
        
        let displayText = `📅 Snapshot recorded on ${formattedDate}`;
        if (currentData.note) {
            displayText += ` · 📝 ${currentData.note}`;
        }
        
        dateTextEl.textContent = displayText;
    } else {
        infoDiv.style.display = 'none';
    }
}

function updateChangeIndicator(elementId, current, previous) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const diff = current - previous;
    const diffAbs = Math.abs(diff);
    const diffFormatted = formatCurrency(diffAbs);

    if (diff === 0 && previous === 0) {
        element.innerHTML = '';
        element.className = 'change-indicator neutral';
        element.style.display = 'none';
        return;
    }

    element.style.display = 'inline-flex';

    if (diff === 0) {
        element.innerHTML = `<span class="arrow">→</span> ₹0`;
        element.className = 'change-indicator neutral';
    } else if (diff > 0) {
        element.innerHTML = `<span class="arrow">↑</span> +${diffFormatted}`;
        element.className = 'change-indicator positive';
    } else {
        element.innerHTML = `<span class="arrow">↓</span> -${diffFormatted}`;
        element.className = 'change-indicator negative';
    }
}

// ============ SNAPSHOT MODAL ============
function showSnapshotModal() {
    const data = getMonthData();
    document.getElementById('snapshotRecordDate').value = data.recordDate || new Date().toISOString().split('T')[0];
    document.getElementById('snapshotBank').value = data.bank || 0;
    document.getElementById('snapshotCash').value = data.cash || 0;
    document.getElementById('snapshotNote').value = data.note || '';
    document.getElementById('snapshotModal').style.display = 'block';
}

function saveSnapshot() {
    const recordDate = document.getElementById('snapshotRecordDate').value;
    const bankInput = document.getElementById('snapshotBank');
    const cashInput = document.getElementById('snapshotCash');
    const note = document.getElementById('snapshotNote').value.trim();
    
    if (!recordDate) {
        showNotification('Please select a date', 'warning');
        return;
    }
    
    let bankValue = parseFloat(bankInput.value);
    let cashValue = parseFloat(cashInput.value);
    
    if (bankInput.value.includes('+') || bankInput.value.includes('-')) {
        const result = evaluateExpression(bankInput.value);
        if (result !== null) {
            bankValue = result;
        } else {
            showNotification('Invalid bank balance expression', 'warning');
            return;
        }
    }
    
    if (cashInput.value.includes('+') || cashInput.value.includes('-')) {
        const result = evaluateExpression(cashInput.value);
        if (result !== null) {
            cashValue = result;
        } else {
            showNotification('Invalid cash balance expression', 'warning');
            return;
        }
    }
    
    if (isNaN(bankValue) || bankValue < 0) {
        showNotification('Please enter a valid bank balance', 'warning');
        return;
    }
    if (isNaN(cashValue) || cashValue < 0) {
        showNotification('Please enter a valid cash balance', 'warning');
        return;
    }

    const data = getMonthData();
    data.bank = Math.round(bankValue * 100) / 100;
    data.cash = Math.round(cashValue * 100) / 100;
    data.recordDate = recordDate;
    data.note = note;

    saveData();
    renderAll();
    closeModal('snapshotModal');
    showNotification('✅ Snapshot saved!', 'success');
}

// ============ CATEGORY MANAGEMENT (Month Specific) ============
function renderCategoryList() {
    const container = document.getElementById('categoryList');
    const categories = getMonthCategories();
    
    if (categories.length === 0) {
        container.innerHTML = '<p style="color:#6b7280;font-size:13px;">No categories for this month. Add one above!</p>';
        return;
    }

    container.innerHTML = categories.map(cat => `
        <span class="category-tag">
            ${cat}
            <button class="cat-delete" onclick="deleteCategory('${cat}')" title="Delete category">✕</button>
        </span>
    `).join('');
}

function addCategory() {
    const input = document.getElementById('newCategory');
    const name = input.value.trim();

    if (!name) {
        showNotification('Please enter a category name', 'warning');
        return;
    }
    
    const data = getMonthData();
    if (data.categories.includes(name)) {
        showNotification('Category already exists for this month!', 'warning');
        return;
    }

    data.categories.push(name);
    data.categories.sort();
    saveData();
    
    renderCategoryList();
    populateBudgetInputs();
    populateCategorySelect();
    renderAll();
    
    input.value = '';
    showNotification('✅ Category added! You can now set its budget below.', 'success');
}

function deleteCategory(category) {
    const data = getMonthData();
    
    const expenses = data.expenses.filter(e => e.category === category);
    if (expenses.length > 0) {
        if (!confirm(`Category "${category}" has ${expenses.length} expense(s). Delete anyway?`)) {
            return;
        }
        data.expenses = data.expenses.filter(e => e.category !== category);
    }
    
    if (data.budgets && data.budgets[category] !== undefined) {
        delete data.budgets[category];
    }
    
    data.categories = data.categories.filter(c => c !== category);
    saveData();
    renderAll();
    showNotification('🗑️ Category deleted', 'info');
}

// ============ BUDGET SETUP ============
function showBudgetSetup() {
    renderCategoryList();
    populateBudgetInputs();
    document.getElementById('budgetModal').style.display = 'block';
}

function populateBudgetInputs() {
    const container = document.getElementById('budgetInputs');
    const data = getMonthData();
    const budgets = data.budgets || {};
    const categories = data.categories || [];

    if (categories.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding:12px;">
                <p style="font-size:13px;">No categories for this month. Add one above!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = categories.map(cat => `
        <div class="form-group">
            <label>${cat}</label>
            <input type="number" id="budget_${cat}" step="0.01" min="0"
                   value="${budgets[cat] || ''}" placeholder="No budget" />
        </div>
    `).join('');
}

function saveBudgets(e) {
    e.preventDefault();

    const data = getMonthData();
    if (!data.budgets) data.budgets = {};

    const categories = data.categories || [];
    categories.forEach(cat => {
        const input = document.getElementById(`budget_${cat}`);
        if (input && input.value && parseFloat(input.value) > 0) {
            data.budgets[cat] = parseFloat(input.value) || 0;
        } else {
            delete data.budgets[cat];
        }
    });

    saveData();
    renderBudgetOverview();
    closeModal('budgetModal');
    showNotification('✅ Budgets saved successfully!', 'success');
}

// ============ COPY BUDGET FROM ANY PAST MONTH (UPDATED) ============
function showCopyBudgetModal() {
    copyBudgetCurrentPage = 0;
    copyBudgetAllMonths = getAvailablePastMonths();
    
    const container = document.getElementById('availableMonths');
    
    // Build the month picker HTML
    const monthPickerHtml = `
        <div class="month-picker-container">
            <div class="picker-group">
                <label>Month</label>
                <select id="copyMonthPicker">
                    ${Array.from({length: 12}, (_, i) => {
                        const month = i + 1;
                        const monthName = new Date(2000, i, 1).toLocaleString('default', { month: 'long' });
                        const val = String(month).padStart(2, '0');
                        return `<option value="${val}">${monthName}</option>`;
                    }).join('')}
                </select>
            </div>
            <div class="picker-group">
                <label>Year</label>
                <select id="copyYearPicker">
                    ${Array.from({length: 10}, (_, i) => {
                        const year = new Date().getFullYear() - i;
                        return `<option value="${year}">${year}</option>`;
                    }).join('')}
                </select>
            </div>
            <div class="month-picker-actions">
                <button class="btn-primary small" onclick="loadSpecificMonth()" style="padding:8px 16px;font-size:13px;">Load</button>
                <button class="btn-secondary small" onclick="resetCopyBudgetView()" style="padding:8px 16px;font-size:13px;">Recent</button>
            </div>
        </div>
        <div id="copyBudgetList" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;"></div>
        <div id="copyBudgetPagination" class="copy-pagination"></div>
        <div id="copyBudgetEmpty" style="display:none;text-align:center;padding:30px 20px;color:#6b7280;">
            <div style="font-size:40px;margin-bottom:8px;">📭</div>
            <p>No months found with budgets or categories.</p>
        </div>
    `;
    
    container.innerHTML = monthPickerHtml;
    
    // Set default month to current month
    const now = new Date();
    document.getElementById('copyMonthPicker').value = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('copyYearPicker').value = now.getFullYear();
    
    renderCopyBudgetPage();
    document.getElementById('copyBudgetModal').style.display = 'block';
}

function renderCopyBudgetPage() {
    const container = document.getElementById('copyBudgetList');
    const pagination = document.getElementById('copyBudgetPagination');
    const emptyEl = document.getElementById('copyBudgetEmpty');
    
    if (copyBudgetAllMonths.length === 0) {
        container.innerHTML = '';
        pagination.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    
    emptyEl.style.display = 'none';
    
    const start = copyBudgetCurrentPage * COPY_BUDGET_MONTHS_PER_PAGE;
    const end = Math.min(start + COPY_BUDGET_MONTHS_PER_PAGE, copyBudgetAllMonths.length);
    const pageMonths = copyBudgetAllMonths.slice(start, end);
    const totalPages = Math.ceil(copyBudgetAllMonths.length / COPY_BUDGET_MONTHS_PER_PAGE);
    
    container.innerHTML = pageMonths.map(({ key, budgetCount, categoryCount }) => {
        const date = new Date(key + '-01');
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return `
            <div class="month-option">
                <div>
                    <div class="month-name">${monthName}</div>
                    <div class="month-details">${budgetCount} budget(s) · ${categoryCount} category(ies)</div>
                </div>
                <button class="copy-btn" onclick="copyBudgetFromMonth('${key}')">📋 Copy</button>
            </div>
        `;
    }).join('');
    
    // Pagination
    if (totalPages > 1) {
        let paginationHtml = '';
        for (let i = 0; i < totalPages; i++) {
            paginationHtml += `
                <button class="page-btn ${i === copyBudgetCurrentPage ? 'active' : 'inactive'}" 
                        onclick="goToCopyBudgetPage(${i})">
                    ${i + 1}
                </button>
            `;
        }
        pagination.innerHTML = paginationHtml;
    } else {
        pagination.innerHTML = '';
    }
}

function goToCopyBudgetPage(page) {
    copyBudgetCurrentPage = page;
    renderCopyBudgetPage();
}

function loadSpecificMonth() {
    const month = document.getElementById('copyMonthPicker').value;
    const year = parseInt(document.getElementById('copyYearPicker').value);
    const monthKey = `${year}-${month}`;
    
    // Check if this month exists in the list
    const existing = copyBudgetAllMonths.find(m => m.key === monthKey);
    
    if (existing) {
        // If it exists, find its index and go to that page
        const index = copyBudgetAllMonths.indexOf(existing);
        copyBudgetCurrentPage = Math.floor(index / COPY_BUDGET_MONTHS_PER_PAGE);
        renderCopyBudgetPage();
    } else {
        // If it doesn't exist, check if we have data for this month
        const monthData = state.months[monthKey];
        if (monthData && (Object.keys(monthData.budgets || {}).length > 0 || (monthData.categories || []).length > 0)) {
            // Add it to the list and go to it
            const hasBudgets = monthData.budgets && Object.keys(monthData.budgets).length > 0;
            const hasCategories = monthData.categories && monthData.categories.length > 0;
            copyBudgetAllMonths.push({
                key: monthKey,
                budgetCount: Object.keys(monthData.budgets || {}).length,
                categoryCount: (monthData.categories || []).length
            });
            copyBudgetAllMonths.sort((a, b) => b.key.localeCompare(a.key));
            const index = copyBudgetAllMonths.findIndex(m => m.key === monthKey);
            copyBudgetCurrentPage = Math.floor(index / COPY_BUDGET_MONTHS_PER_PAGE);
            renderCopyBudgetPage();
        } else {
            showNotification('No budgets or categories found for this month.', 'warning');
        }
    }
}

function resetCopyBudgetView() {
    copyBudgetAllMonths = getAvailablePastMonths();
    copyBudgetCurrentPage = 0;
    renderCopyBudgetPage();
}

function copyBudgetFromMonth(sourceMonthKey) {
    const currentKey = MONTH_KEY();
    const sourceData = state.months[sourceMonthKey];
    const currentData = getMonthData(currentKey);
    
    if (!sourceData) {
        showNotification('Source month not found!', 'error');
        return;
    }
    
    const budgetCount = Object.keys(sourceData.budgets || {}).length;
    const categoryCount = (sourceData.categories || []).length;
    
    if (budgetCount === 0 && categoryCount === 0) {
        showNotification('No budgets or categories found in source month.', 'warning');
        return;
    }
    
    if (!confirm(`Copy ${budgetCount} budget(s) and ${categoryCount} category(ies) from ${formatMonthKey(sourceMonthKey)} to ${formatMonthKey(currentKey)}?`)) return;
    
    // Copy categories (merge with existing)
    if (sourceData.categories && sourceData.categories.length > 0) {
        sourceData.categories.forEach(cat => {
            if (!currentData.categories.includes(cat)) {
                currentData.categories.push(cat);
            }
        });
        currentData.categories.sort();
    }
    
    // Copy budgets
    if (sourceData.budgets) {
        Object.keys(sourceData.budgets).forEach(cat => {
            if (currentData.categories.includes(cat)) {
                currentData.budgets[cat] = sourceData.budgets[cat];
            }
        });
    }
    
    saveData();
    renderAll();
    closeModal('copyBudgetModal');
    showNotification(`✅ Copied from ${formatMonthKey(sourceMonthKey)}!`, 'success');
}

function formatMonthKey(monthKey) {
    const parts = monthKey.split('-');
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ============ CATEGORY SELECT DROPDOWN ============
function populateCategorySelect() {
    const select = document.getElementById('expenseCategory');
    const currentValue = select.value;
    const categories = getMonthCategories();

    select.innerHTML = '<option value="">Select a category...</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });

    if (currentValue && categories.includes(currentValue)) {
        select.value = currentValue;
    }

    const filter = document.getElementById('categoryFilter');
    const filterValue = filter.value;
    filter.innerHTML = '<option value="all">All Categories</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        filter.appendChild(opt);
    });
    if (filterValue && categories.includes(filterValue)) {
        filter.value = filterValue;
    } else {
        filter.value = 'all';
    }
}

// ============ EXPENSE MANAGEMENT ============
function generateExpenseId() {
    return 'exp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showAddExpense() {
    const categories = getMonthCategories();
    if (categories.length === 0) {
        showNotification('Please create at least one category for this month first!', 'warning');
        showBudgetSetup();
        return;
    }
    
    document.getElementById('editExpenseId').value = '';
    document.getElementById('expenseModalTitle').textContent = '➕ Add Expense';
    document.getElementById('expenseSubmitBtn').textContent = 'Add Expense';
    document.getElementById('expenseCategory').value = '';
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseNote').value = '';
    document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('expenseModal').style.display = 'block';
    document.getElementById('expensePreview').style.display = 'none';
}

function editExpense(expenseId) {
    if (!expenseId) {
        showNotification('Invalid expense ID', 'error');
        return;
    }
    
    const data = getMonthData();
    const expense = data.expenses.find(e => e.id === expenseId);
    
    if (!expense) {
        showNotification('Expense not found!', 'error');
        renderExpenses();
        return;
    }

    document.getElementById('editExpenseId').value = expenseId;
    document.getElementById('expenseModalTitle').textContent = '✏️ Edit Expense';
    document.getElementById('expenseSubmitBtn').textContent = 'Update Expense';
    document.getElementById('expenseCategory').value = expense.category;
    document.getElementById('expenseAmount').value = expense.amount;
    document.getElementById('expenseNote').value = expense.note || '';
    document.getElementById('expenseDate').value = expense.date;
    document.getElementById('expenseModal').style.display = 'block';
    document.getElementById('expensePreview').style.display = 'none';
}

function saveExpense(e) {
    e.preventDefault();

    const editId = document.getElementById('editExpenseId').value;
    const category = document.getElementById('expenseCategory').value;
    const amountInput = document.getElementById('expenseAmount');
    const date = document.getElementById('expenseDate').value;
    const note = document.getElementById('expenseNote').value.trim();

    if (!category) {
        showNotification('Please select a category', 'warning');
        return;
    }

    let amount;
    if (amountInput.value.includes('+') || amountInput.value.includes('-')) {
        const result = evaluateExpression(amountInput.value);
        if (result !== null && result > 0) {
            amount = Math.round(result * 100) / 100;
        } else {
            showNotification('Invalid amount expression', 'warning');
            return;
        }
    } else {
        amount = parseFloat(amountInput.value);
    }

    if (!amount || amount <= 0) {
        showNotification('Please enter a valid amount', 'warning');
        return;
    }

    const data = getMonthData();

    if (editId) {
        const index = data.expenses.findIndex(e => e.id === editId);
        if (index === -1) {
            showNotification('Expense not found!', 'error');
            renderExpenses();
            closeModal('expenseModal');
            return;
        }
        
        data.expenses[index] = {
            ...data.expenses[index],
            category: category,
            amount: amount,
            date: date,
            note: note
        };
        
        saveData();
        renderAll();
        closeModal('expenseModal');
        showNotification('✅ Expense updated successfully!', 'success');
    } else {
        const newExpense = {
            id: generateExpenseId(),
            category: category,
            amount: amount,
            date: date,
            note: note
        };
        
        data.expenses.push(newExpense);
        saveData();
        renderAll();
        closeModal('expenseModal');
        showNotification('✅ Expense added successfully!', 'success');
    }
    
    document.getElementById('expenseForm').reset();
    document.getElementById('expensePreview').style.display = 'none';
}

function deleteExpense(expenseId) {
    if (!expenseId) {
        showNotification('Invalid expense ID', 'error');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this expense?')) {
        return;
    }
    
    const data = getMonthData();
    const initialLength = data.expenses.length;
    data.expenses = data.expenses.filter(e => e.id !== expenseId);
    
    if (data.expenses.length === initialLength) {
        showNotification('Expense not found!', 'error');
        renderExpenses();
        return;
    }
    
    saveData();
    renderAll();
    showNotification('🗑️ Expense deleted successfully!', 'success');
}

function getMonthExpenses() {
    const data = getMonthData();
    return data.expenses || [];
}

// ============ RENDER EXPENSES ============
function renderExpenses() {
    const container = document.getElementById('expenseList');
    const categoryFilter = document.getElementById('categoryFilter').value;
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();

    let expenses = getMonthExpenses();

    if (categoryFilter !== 'all') {
        expenses = expenses.filter(e => e.category === categoryFilter);
    }

    if (searchTerm) {
        expenses = expenses.filter(e =>
            (e.note || '').toLowerCase().includes(searchTerm) ||
            e.category.toLowerCase().includes(searchTerm)
        );
    }

    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (expenses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📭</div>
                <p>No expenses for this month</p>
            </div>
        `;
        return;
    }

    container.innerHTML = expenses.map(e => `
        <div class="expense-item">
            <div class="ei-info" onclick="editExpense('${e.id}')">
                <span class="ei-category">${e.category}</span>
                ${e.note ? `<span class="ei-note">${e.note}</span>` : ''}
                <span class="ei-date">${formatDate(e.date)}</span>
            </div>
            <div class="ei-actions">
                <span class="ei-amount">${formatCurrency(e.amount)}</span>
                <button class="ei-edit-btn" onclick="editExpense('${e.id}')" title="Edit">✏️</button>
                <button class="ei-delete-btn" onclick="deleteExpense('${e.id}')" title="Delete">✕</button>
            </div>
        </div>
    `).join('');
}

// ============ RECENT EXPENSES ============
function renderRecentExpenses() {
    const container = document.getElementById('recentExpenses');
    let expenses = getMonthExpenses();

    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = expenses.slice(0, 5);

    if (recent.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="emoji">🕐</div>
                <p>No recent expenses</p>
            </div>
        `;
        return;
    }

    container.innerHTML = recent.map(e => `
        <div class="recent-item" onclick="editExpense('${e.id}')">
            <div class="ri-left">
                <span class="ri-category">${e.category}</span>
                ${e.note ? `<span class="ri-note">${e.note}</span>` : ''}
                <span class="ri-date">${formatDate(e.date)}</span>
            </div>
            <span class="ri-amount">${formatCurrency(e.amount)}</span>
        </div>
    `).join('');
}

// ============ CATEGORY CHART ============
function renderCategoryChart() {
    const container = document.getElementById('categoryChart');
    const expenses = getMonthExpenses();

    const grouped = {};
    expenses.forEach(e => {
        grouped[e.category] = (grouped[e.category] || 0) + e.amount;
    });

    const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const max = sorted.length > 0 ? Math.max(...sorted.map(([_, v]) => v)) : 1;

    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📊</div>
                <p>No expenses to chart</p>
            </div>
        `;
        return;
    }

    const colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4',
        '#84cc16', '#d946ef'
    ];

    container.innerHTML = sorted.map(([category, amount], index) => {
        const pct = (amount / max * 100);
        const color = colors[index % colors.length];
        return `
            <div class="chart-bar">
                <span class="label">${category}</span>
                <div class="bar-track">
                    <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
                </div>
                <span class="amount">${formatCurrency(amount)}</span>
            </div>
        `;
    }).join('');
}

// ============ BUDGET OVERVIEW ============
function renderBudgetOverview() {
    const container = document.getElementById('budgetOverview');
    const data = getMonthData();
    const budgets = data.budgets || {};
    const expenses = getMonthExpenses();

    const cats = new Set([...Object.keys(budgets), ...expenses.map(e => e.category)]);

    if (cats.size === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="emoji">🎯</div>
                <p>Set budgets or add expenses to see tracking</p>
            </div>
        `;
        return;
    }

    const spent = {};
    let totalSpent = 0;
    let totalBudget = 0;
    
    expenses.forEach(e => {
        spent[e.category] = (spent[e.category] || 0) + e.amount;
        totalSpent += e.amount;
    });

    // Calculate total budget (sum of all budgets)
    Object.values(budgets).forEach(amount => {
        totalBudget += amount;
    });

    let html = '';

    // Add total expenses summary at the top
    html += `
        <div class="total-summary">
            <div class="summary-item">
                <span class="summary-label">Total Expenses</span>
                <span class="summary-amount total-expenses">${formatCurrency(totalSpent)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Budget</span>
                <span class="summary-amount total-budget">${formatCurrency(totalBudget)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Remaining</span>
                <span class="summary-amount ${totalBudget - totalSpent >= 0 ? 'positive' : 'negative'}">${formatCurrency(totalBudget - totalSpent)}</span>
            </div>
        </div>
        <div class="budget-divider"></div>
        <br>
    `;

    cats.forEach(cat => {
        const limit = budgets[cat] || 0;
        const spentAmount = spent[cat] || 0;
        
        const threshold = limit * 1.01;
        
        let status = 'none';
        let badgeText = 'No budget';
        let progressColor = '#10b981';
        
        if (limit > 0) {
            if (spentAmount >= threshold) {
                status = 'danger';
                badgeText = '⚠️ Over Budget';
                progressColor = '#ef4444';
            } else if (spentAmount >= limit) {
                status = 'warning';
                badgeText = '⚠️ Near Limit';
                progressColor = '#f59e0b';
            } else if (spentAmount >= limit * 0.8) {
                status = 'warning';
                badgeText = '⚠️ Near Limit';
                progressColor = '#f59e0b';
            } else {
                status = 'ok';
                badgeText = '✅ On track';
                progressColor = '#10b981';
            }
        }

        const displayPct = limit > 0 ? Math.min((spentAmount / limit) * 100, 100) : 0;

        html += `
            <div class="budget-item">
                <span class="cat-name">${cat}</span>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${displayPct}%;background:${progressColor}"></div>
                </div>
                <span class="budget-text">${formatCurrency(spentAmount)} / ${formatCurrency(limit)}</span>
                <span class="status-badge ${status}">${badgeText}</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ============ CLEAR MONTH DATA ============
function clearMonthData() {
    const key = MONTH_KEY();
    if (!state.months[key]) {
        showNotification('No data for this month to clear.', 'info');
        return;
    }

    if (!confirm(`⚠️ Delete ALL data for ${currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}?\nThis cannot be undone.`)) return;

    delete state.months[key];
    saveData();
    renderAll();
    showNotification('✅ Month data cleared!', 'success');
}

// ============ NOTIFICATION SYSTEM ============
function showNotification(message, type = 'info') {
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();
    
    const colors = {
        success: '#10b981',
        warning: '#f59e0b',
        info: '#4a6cf7',
        error: '#ef4444'
    };
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============ MODAL HELPERS ============
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};

// ============ UTILITY FUNCTIONS ============
function formatCurrency(amount) {
    return '₹' + amount.toFixed(2);
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============ KEYBOARD SHORTCUTS ============
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showAddExpense();
    }
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }
});

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
    initAuth();
});
