let sales_data = [];
const salesStorageKey = 'sales_ui_records';

function loadSalesData() {
	try {
		const raw = localStorage.getItem(salesStorageKey);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		const data = Array.isArray(parsed) ? parsed : [];
		// Backfill updated_at (used exclusively for Last Updated) on any record that doesn't have it
		const now = moment().toISOString();
		let needsSave = false;
		data.forEach(function (record) {
			if (!record.updated_at) {
				record.updated_at = now;
				needsSave = true;
			}
		});
		if (needsSave) {
			sales_data = data;
			saveSalesData();
		}
		return data;
	} catch (error) {
		console.error('Failed to load sales data:', error);
		return [];
	}
}

function saveSalesData() {
	try {
		localStorage.setItem(salesStorageKey, JSON.stringify(sales_data));
	} catch (error) {
		console.error('Failed to save sales data:', error);
	}
}

// Modal close/dirty tracking
let modalInitialState = '';
let modalIsDirty = false;
let allowModalClose = false;
let isInitializingModal = false;
let modalInitTimer = null;
let currentActionStatus = null; // "Set" | "Rolled" | null
let currentActionMode = null; // "set" | "roll" | null
let currentActionRecord = null;
let expandedSaleId = null;
let newlyAddedSaleId = null;
let currentSetRecord = null;
let currentRollRecord = null;
let currentRollOriginMonth = null;
let defaultSaleDateLabel = 'Sale Date';
let defaultModalTitle = 'Customer ABC / CORN 2025';
let defaultModalSubtitle = 'Add Sale';
const deliveryLocationOptions = [
	{ id: 1001, label: 'End User Example 1, Anytown US' },
	{ id: 1002, label: 'End User Example 2, Anytown US' },
	{ id: 1003, label: 'Elevator Coop Example 1, Anytown US' },
	{ id: 1004, label: 'Elevator Coop Example 2, Anytown US' }
];

function populateDeliveryLocationOptions() {
	const $list = $('#delivery_location_list');
	if (!$list.length) return;
	$list.empty();
	deliveryLocationOptions.forEach(option => {
		$('<option>')
			.attr('value', option.label)
			.attr('data-value', option.id)
			.appendTo($list);
	});
}

function getOriginRecord(record) {
	if (!record) return null;
	if (!record.parent_id) return record;
	return sales_data.find(sale => sale.id === record.parent_id) || record;
}

/** Bushels not yet Set or Rolled from this record (origin or any ledger row). */
function getRemainingQuantity(record) {
	const origin = getOriginRecord(record);
	if (!origin) return parseInt(record.quantity || 0, 10) || 0;
	const allChildRecords = sales_data.filter(r => r.parent_id === origin.id || r.id === origin.id);
	const consumedFromThis = allChildRecords
		.filter(r => (r.status === 'Set' || r.status === 'Rolled') && getSourceId(r) === record.id)
		.reduce((sum, r) => sum + (parseInt(r.quantity || 0, 10) || 0), 0);
	const recordQty = parseInt(record.quantity || 0, 10) || 0;
	return Math.max(0, recordQty - consumedFromThis);
}

/** Id of the record this Set/Roll consumed from. Defaults to parent_id for backward compat. */
function getSourceId(record) {
	return record.source_id != null ? record.source_id : record.parent_id;
}

/** Bushels from this record not yet consumed by Set/Roll records that consumed from this record. */
function getRemainingFromRecord(record) {
	const origin = getOriginRecord(record);
	if (!origin) return parseInt(record.quantity || 0, 10) || 0;
	const allChildRecords = sales_data.filter(r => r.parent_id === origin.id || r.id === origin.id);
	const consumedFromThis = allChildRecords
		.filter(r => (r.status === 'Set' || r.status === 'Rolled') && getSourceId(r) === record.id)
		.reduce((sum, r) => sum + (parseInt(r.quantity || 0, 10) || 0), 0);
	const recordQty = parseInt(record.quantity || 0, 10) || 0;
	return Math.max(0, recordQty - consumedFromThis);
}

function resetActionState() {
	currentActionStatus = null;
	currentActionMode = null;
	currentActionRecord = null;
	currentRollOriginMonth = null;
	$('#saveSaleBtn').removeClass('hideByDefault');
	$('#splitSetBtn, #splitRollBtn').addClass('hideByDefault');
	const $saleDateLabel = $('label[for="sale_date"]');
	if ($saleDateLabel.length) {
		$saleDateLabel.contents().first()[0].textContent = defaultSaleDateLabel;
	}
	$('label[for="delivery_location"]').contents().first()[0].textContent = 'Delivery Location';
	$('#carry_elem').removeClass('_show').addClass('hideByDefault');
	$('#req_carry').addClass('required-asterisk-hidden');
	$('#sale_type').prop('disabled', false);
	$('#futures_month, #nearby_futures_month, #initial_basis_price, #quantity, #futures_price, #basis_price, #hta_contract_holder, #basis_contract_holder')
		.prop('disabled', false);
	// Clear date picker min restriction so Add/Edit aren't limited
	if (window.sales_date_picker) {
		window.sales_date_picker.updateOptions({ restrictions: { minDate: undefined } });
	}
	$('#futures_month_options li').removeClass('futures-month-disabled');
	$('#modalTitle').text(defaultModalTitle);
	$('#modalSubtitle').text(defaultModalSubtitle);
}

function setActionLabels(actionLabel, deliveryLabel) {
	const $saleDateLabel = $('label[for="sale_date"]');
	if ($saleDateLabel.length) {
		$saleDateLabel.contents().first()[0].textContent = actionLabel;
	}
	if (deliveryLabel) {
		const $deliveryLabel = $('label[for="delivery_location"]');
		if ($deliveryLabel.length) {
			$deliveryLabel.contents().first()[0].textContent = deliveryLabel;
		}
	}
}

function openActionModal(actionType, record, splitQuantity = null) {
	const origin = getOriginRecord(record);
	if (!origin) return;
	clearSalesForm();
	currentActionRecord = record;
	currentActionMode = actionType === 'Set' ? 'set' : 'roll';
	currentActionStatus = actionType === 'Set' ? 'Set' : 'Rolled';
	currentRollOriginMonth = actionType === 'Roll' ? (origin.futures_month || null) : null;
	$('#sale_id').val('');
	$('#parent_id').val(origin.id);
	$('#sale_type').val(record.sale_type || origin.sale_type);
	checkSalesType();
	$('#sale_type').prop('disabled', true);

	// Set modal title
	const actionTitle = `${origin.sale_type}: ${actionType}`;
	$('#modalTitle').text(defaultModalTitle);
	$('#modalSubtitle').text(actionTitle);
	$('#saveSaleBtn').addClass('hideByDefault');
	$('#splitSetBtn, #splitRollBtn').addClass('hideByDefault');
	if (actionType === 'Set') {
		$('#splitSetBtn').removeClass('hideByDefault').text('Set');
	} else {
		$('#splitRollBtn').removeClass('hideByDefault').text('Roll');
	}
	setActionLabels(actionType === 'Set' ? 'Delivery Date' : 'Roll Date', `${origin.sale_type} Delivery Location`);

	// Populate shared fields (Set: Delivery Date null; Roll: Roll Date null)
	$('#sale_date').val((actionType === 'Set' || actionType === 'Roll') ? '' : moment().format('YYYY-MM-DD'));
	if (actionType === 'Set' || actionType === 'Roll') {
		$('#sale_date').attr('placeholder', '-Select-');
		// Only selectable dates >= tracking record's Sale Date (local date, not UTC)
		if (window.sales_date_picker && record.sale_date) {
			const minDateLocal = moment(record.sale_date).startOf('day').toDate();
			window.sales_date_picker.updateOptions({ restrictions: { minDate: minDateLocal } });
		}
	} else {
		$('#sale_date').attr('placeholder', '');
		if (window.sales_date_picker) {
			window.sales_date_picker.updateOptions({ restrictions: { minDate: undefined } });
		}
	}
	$('#quantity').val((splitQuantity || record.quantity) != null ? formatSetQuantity(parseInt(splitQuantity || record.quantity, 10)) : '');
	$('#comments').val('');
	$('#futures_month').val(record.futures_month ? record.futures_month.slice(0, 7) : '');
	if (record.futures_month) {
		$('#futuresMonthSelector').html(`<span>${formatMonth(record.futures_month)}</span>`);
	}
	$('#futures_price').val(record.futures_price !== null && record.futures_price !== undefined ? record.futures_price.toFixed(4) : '');
	$('#basis_price').val(record.basis_price !== null && record.basis_price !== undefined ? record.basis_price.toFixed(4) : '');
	$('#service_fee').val(''); // Set/Roll form: always reset to null
	$('#delivery_location').val(record.delivery_location || '');
	$('#delivery_month').val(record.delivery_month || '');
	$('#merch_gain').val(''); // Set/Roll form: always reset to null

	if (origin.sale_type === 'HTA') {
		$('#nearby_futures_month').val(record.nearby_futures_month ? record.nearby_futures_month.slice(0, 7) : '');
		if (record.nearby_futures_month) {
			$('#nearbyFuturesMonthSelector').html(`<span>${formatMonth(record.nearby_futures_month)}</span>`);
		}
		$('#initial_basis_price').val(record.initial_basis_price !== null && record.initial_basis_price !== undefined ? record.initial_basis_price.toFixed(4) : '');
		$('#hta_contract_holder').val(record.hta_contract_holder || '');
	}
	if (origin.sale_type === 'Basis') {
		$('#basis_contract_holder').val(record.basis_contract_holder || '');
	}

	// Action-specific field states
	if (currentActionMode === 'set') {
		$('#sale_type').prop('disabled', true);
		$('#futures_month, #quantity').prop('disabled', true);
		$('#nearby_futures_month, #initial_basis_price, #hta_contract_holder, #basis_contract_holder').prop('disabled', true);
		$('#futures_price').prop('disabled', origin.sale_type !== 'Basis');
		if (origin.sale_type === 'HTA') {
			$('#futures_price_elem').addClass('field-disabled');
			$('#nearby_futures_month_elem').addClass('field-disabled');
		}
		$('#basis_price').prop('disabled', origin.sale_type === 'Basis');
		if (origin.sale_type === 'Basis') {
			$('#basis_price_elem').addClass('field-disabled');
		}
		$('#futuresMonthSelector').closest('.dropdown').addClass('field-disabled');
		$('#futuresMonthSelector')
			.prop('disabled', true)
			.addClass('disabled');
		$('#nearbyFuturesMonthSelector')
			.prop('disabled', true)
			.addClass('disabled');
		$('#hta_contract_holder_elem, #basis_contract_holder_elem').addClass('field-disabled');
	} else {
		$('#futures_price_elem').removeClass('field-disabled');
		$('#basis_price_elem').removeClass('field-disabled');
		$('#futuresMonthSelector').closest('.dropdown').removeClass('field-disabled');
		$('#sale_type').prop('disabled', true);
		$('#carry_elem').removeClass('hideByDefault').addClass('_show');
		$('#req_carry').removeClass('required-asterisk-hidden');
		$('#futures_price, #basis_price, #nearby_futures_month, #initial_basis_price, #hta_contract_holder, #basis_contract_holder, #quantity')
			.prop('disabled', true);
		$('#initial_basis_price_elem').addClass('field-disabled');
		$('#hta_contract_holder_elem, #basis_contract_holder_elem').addClass('field-disabled');
		$('#futures_month').prop('disabled', false);
		if (origin.sale_type === 'HTA') {
			$('#futures_price').prop('disabled', false);
			$('#nearby_futures_month_elem').addClass('field-disabled');
			$('#basis_price_elem').addClass('field-disabled');
		}
		if (origin.sale_type === 'Basis') {
			$('#futures_price').prop('disabled', true);
			$('#basis_price').prop('disabled', true);
			$('#futures_price_elem').addClass('field-disabled');
			$('#basis_price_elem').addClass('field-disabled');
			$('#futuresMonthSelector').closest('.dropdown').removeClass('field-disabled');
		}
		$('#futuresMonthSelector')
			.prop('disabled', false)
			.removeClass('disabled');
		$('#nearbyFuturesMonthSelector')
			.prop('disabled', true)
			.addClass('disabled');
	}
	
	// Trigger cash price calculation for action modes
	$('#futures_price, #basis_price, #service_fee, #carry').trigger('input');

	if (actionType === 'Roll') {
		const origMonth = record.futures_month ? formatMonth(record.futures_month) : '--';
		const origPrice = (record.futures_price != null && record.futures_price !== '') ? formatPrice(record.futures_price) : '--';
		$('#futures_price_original_txt').text(`Orig. Futures Price for ${origMonth}: ${origPrice}`).show();
		$('#salesModal').one('shown.bs.modal', function() {
			populatFutureSelection().then(applyRollFuturesMonthRestrictions);
		});
	} else {
		$('#futures_price_original_txt').text('').hide();
	}

	$('#salesModal').modal('show');
}

function applyRollFuturesMonthRestrictions() {
	if (currentActionStatus !== 'Rolled' || !currentActionRecord || !currentActionRecord.futures_month) {
		$('#futures_month_options li').removeClass('futures-month-disabled');
		return;
	}
	const recordMonth = (currentActionRecord.futures_month || '').slice(0, 7);
	$('#futures_month_options li').each(function() {
		const optionMonth = $(this).attr('data-futures-month') || $(this).data('futures_month') || '';
		if (optionMonth && optionMonth <= recordMonth) {
			$(this).addClass('futures-month-disabled');
		} else {
			$(this).removeClass('futures-month-disabled');
		}
	});
}

function getSetQuantityMax() {
	return parseInt($('#set_quantity').attr('max') || 0, 10) || 1;
}

function parseSetQuantityInput(val) {
	if (val === '' || val === null || val === undefined) return NaN;
	const cleaned = String(val).replace(/,/g, '');
	return parseInt(cleaned, 10);
}

function formatSetQuantity(num) {
	const n = parseInt(num, 10);
	if (Number.isNaN(n)) return '';
	return n.toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function clearSetQuantityValidation() {
	const $input = $('#set_quantity_input');
	$input.removeClass('is-invalid');
	$input.closest('.set-quantity-input-row').find('.invalid-feedback').remove();
}

function validateSetQuantityInput() {
	const raw = $('#set_quantity_input').val();
	const maxVal = getSetQuantityMax();
	const n = parseSetQuantityInput(raw);
	if (raw === '' || raw === null || raw === undefined) {
		return { valid: false, message: 'Enter the number of bushels.' };
	}
	if (Number.isNaN(n)) {
		return { valid: false, message: 'Please enter a valid whole number.' };
	}
	if (n < 1) {
		return { valid: false, message: 'Quantity must be at least 1 bu.' };
	}
	if (n > maxVal) {
		return { valid: false, message: 'Quantity cannot exceed ' + maxVal.toLocaleString() + ' bu.' };
	}
	return { valid: true };
}

function clampSetQuantity(value) {
	const maxVal = getSetQuantityMax();
	const n = parseSetQuantityInput(value);
	if (Number.isNaN(n) || n < 1) return 1;
	return Math.min(Math.max(1, n), maxVal);
}

function getSetQuantitySliderStep() {
	return parseInt($('#set_quantity').attr('step') || 1000, 10) || 1000;
}

function updateSetQuantityFromValue(qty) {
	const maxVal = getSetQuantityMax();
	const clamped = clampSetQuantity(qty);
	$('#set_quantity_input').val(formatSetQuantity(clamped));
	const step = getSetQuantitySliderStep();
	const sliderMin = parseInt($('#set_quantity').attr('min') || 1, 10);
	const sliderMax = parseInt($('#set_quantity').attr('max') || 1, 10);
	const sliderVal = step >= 1000
		? Math.min(sliderMax, Math.max(sliderMin, Math.round(clamped / 1000) * 1000))
		: clamped;
	$('#set_quantity').val(sliderVal);
}

function openSetSelection(record) {
	if (!record) return;
	const origin = getOriginRecord(record);
	currentSetRecord = record;
	const saleType = origin ? origin.sale_type : record.sale_type;
	const title = saleType === 'Basis' ? 'Set Basis Contract' : 'Set HTA Contract';
	$('#setQuantityLabel').text('How many bushels would you like to set?');
	$('#setQuantityBtn').text('Set');
	const isOriginRecord = origin && record.id === origin.id;
	const maxValue = isOriginRecord ? getRemainingQuantity(record) : getRemainingFromRecord(record);
	if (maxValue <= 0) return;
	$('#setQuantityTitle').text(title);
	const maxFormatted = maxValue.toLocaleString();
	$('#set_quantity_max_suffix').text(maxFormatted + ' bu.');
	const useThousandStep = maxValue >= 1000;
	const sliderMin = useThousandStep ? 1000 : 1;
	const sliderStep = useThousandStep ? 1000 : 1;
	$('#set_quantity_min_label').text(useThousandStep ? '1,000 bu.' : '1 bu.');
	$('#set_quantity')
		.attr('min', sliderMin)
		.attr('max', maxValue)
		.attr('step', sliderStep)
		.val(maxValue);
	$('#set_quantity_input')
		.attr('min', 0)
		.attr('max', maxValue)
		.attr('step', 1000)
		.val(maxValue);
	updateSetQuantityFromValue(maxValue);
	const setModal = new bootstrap.Modal(document.getElementById('setQuantityModal'));
	setModal.show();
}

function openRollSelection(record) {
	if (!record) return;
	const origin = getOriginRecord(record);
	currentRollRecord = record;
	const saleType = origin ? origin.sale_type : record.sale_type;
	const title = saleType === 'Basis' ? 'Roll Basis Contract' : 'Roll HTA Contract';
	$('#setQuantityLabel').text('How many bushels would you like to roll?');
	$('#setQuantityBtn').text('Roll');
	const isOriginRecord = origin && record.id === origin.id;
	const maxValue = isOriginRecord ? getRemainingQuantity(record) : getRemainingFromRecord(record);
	if (maxValue <= 0) return;
	$('#setQuantityTitle').text(title);
	const maxFormatted = maxValue.toLocaleString();
	$('#set_quantity_max_suffix').text(maxFormatted + ' bu.');
	const useThousandStep = maxValue >= 1000;
	const sliderMin = useThousandStep ? 1000 : 1;
	const sliderStep = useThousandStep ? 1000 : 1;
	$('#set_quantity_min_label').text(useThousandStep ? '1,000 bu.' : '1 bu.');
	$('#set_quantity')
		.attr('min', sliderMin)
		.attr('max', maxValue)
		.attr('step', sliderStep)
		.val(maxValue);
	$('#set_quantity_input')
		.attr('min', 0)
		.attr('max', maxValue)
		.attr('step', 1000)
		.val(maxValue);
	updateSetQuantityFromValue(maxValue);
	const rollModal = new bootstrap.Modal(document.getElementById('setQuantityModal'));
	rollModal.show();
}

function getSalesModalState() {
	const state = {};
	$('#salesModal').find('input, select, textarea').each(function() {
		const $el = $(this);
		const key = $el.attr('id') || $el.attr('name');
		if (!key) return;
		if ($el.is(':checkbox')) {
			state[key] = $el.is(':checked');
			return;
		}
		if ($el.is(':radio')) {
			if ($el.is(':checked')) {
				state[key] = $el.val();
			}
			return;
		}
		state[key] = $el.val();
	});
	return state;
}

function normalizeModalState(state) {
	const keys = Object.keys(state).sort();
	const sortedState = {};
	keys.forEach((key) => {
		sortedState[key] = state[key];
	});
	return JSON.stringify(sortedState);
}

const saveSale = async function(){

	const id = parseInt($('#sale_id').val()) || 0; // handle as a string if you user UUIDs for sales ledger records
	let parent_id = parseInt($('#parent_id').val()) || 0; // handle as a string if you user UUIDs for sales ledger records
		if (parent_id == 0) parent_id = null;
	const sale_type = $('#sale_type').val() || null;
	let merch_gain = parseFloat($('#merch_gain').val()) || null;
	let nearby_futures_month = $('#nearby_futures_month').val() || null;
	let nearby_futures_price = parseFloat($('#nearby_futures_price').val()) || null;
	let initial_basis_price = parseFloat($('#initial_basis_price').val()) || null;
	let carry = $('#carry').val() || null;

	const sale_date = $('#sale_date').val() || null;
	const futures_month = $('#futures_month').val() || null;
	let delivery_month = $('#delivery_month').val() || null;
	const qVal = parseSetQuantityInput($('#quantity').val());
	const quantity = Number.isNaN(qVal) ? null : qVal;

	let futures_price = $('#futures_price').val() || null;
	const futures_price_reference = $('#futures_price_reference').val() || null;
	if (futures_price !== null && futures_price !== '') {
		futures_price = parseFloat(futures_price);
	}
	if ((futures_price === null || futures_price === '') && futures_price_reference) {
		const parsedReference = parseFloat(futures_price_reference);
		if (!Number.isNaN(parsedReference)) {
			futures_price = parsedReference;
		}
	}
	let basis_price = $('#basis_price').val() || null;
	if (basis_price !== null && basis_price !== '') {
		basis_price = parseFloat(basis_price);
	}
	let service_fee = $('#service_fee').val() || null;
	if (service_fee !== null && service_fee !== '') {
		service_fee = parseFloat(service_fee);
	}
	if (carry !== null && carry !== '') {
		carry = parseFloat(carry);
	}
	let cash_price = $('#cash_price').val() || null;
	if (cash_price !== null && cash_price !== '') {
		cash_price = parseFloat(cash_price);
	}
	
	let hta_contract_holder = $('#hta_contract_holder').val() || null;
	let basis_contract_holder = $('#basis_contract_holder').val() || null;
	let delivery_location = $('#delivery_location').val() || null;

	const comments = $('#comments').val() || null;
	
	if (sale_type == 'Cash') {
		nearby_futures_month = null;
		nearby_futures_price = null;
		initial_basis_price = null;
		hta_contract_holder = null;
		basis_contract_holder = null;
		carry = null;
	}
	else if (sale_type == 'HTA') {
		basis_contract_holder = null;
		if (currentActionStatus !== 'Set') {
			delivery_month = null;
		}
	}
	else if (sale_type == 'Basis') {
		nearby_futures_month = null;
		nearby_futures_price = null;
		initial_basis_price = null;
		hta_contract_holder = null;
		if (currentActionStatus !== 'Set') {
			delivery_month = null;
		}
	}

	// Clear previous validation errors
	$('#salesModal .form-control, #salesModal .form-select').removeClass('is-invalid');
	$('#salesModal .invalid-feedback').remove();

	let errors = [];
	const $saleType = $('#sale_type');
	const $saleDate = $('#sale_date');
	const $futuresMonth = $('#futures_month');
	const $quantity = $('#quantity');
	const $deliveryMonth = $('#delivery_month');
	const $futuresPrice = $('#futures_price');
	const $basisPrice = $('#basis_price');
	const $deliveryLocation = $('#delivery_location');
	const $nearbyFuturesMonth = $('#nearby_futures_month');
	const $initialBasisPrice = $('#initial_basis_price');
	const $htaContractHolder = $('#hta_contract_holder');
	const $basisContractHolder = $('#basis_contract_holder');
	const $carry = $('#carry');

	// Common required fields for all sale types
	if (!sale_type) {
		errors.push({err:'Sales Type is required.', elem: $saleType, field: 'sale_type'});
	}
	if (!sale_date) {
		errors.push({err:'Sale Date is required.', elem: $saleDate, field: 'sale_date'});
	}
	if (!futures_month) {
		// For custom dropdown, validate the hidden input and highlight the button
		const $futuresMonthButton = $('#futuresMonthSelector');
		errors.push({err:'Futures Month is required.', elem: $futuresMonthButton, field: 'futures_month'});
	}
	if (!quantity || quantity <= 0) {
		errors.push({err:'Quantity is required.', elem: $quantity, field: 'quantity'});
	}

	// Action-specific validation
	if (currentActionStatus === 'Rolled') {
		if (!carry && carry !== 0) {
			errors.push({err:'Carry is required.', elem: $carry, field: 'carry'});
		}
		if (currentRollOriginMonth && futures_month) {
			const originMonth = currentRollOriginMonth.slice(0, 7);
			const selectedMonth = futures_month.slice(0, 7);
			if (selectedMonth <= originMonth) {
				const $futuresMonthButton = $('#futuresMonthSelector');
				errors.push({err:'Futures Month must be later than the originating record Futures Month.', elem: $futuresMonthButton, field: 'futures_month'});
			}
		}
		// Prohibit Futures Month earlier than the tracking record we're rolling from
		if (currentActionRecord && currentActionRecord.futures_month && futures_month) {
			const recordMonth = (currentActionRecord.futures_month || '').slice(0, 7);
			const selectedMonth = futures_month.slice(0, 7);
			if (recordMonth && selectedMonth < recordMonth) {
				const $futuresMonthButton = $('#futuresMonthSelector');
				errors.push({err: "Futures Month cannot be earlier than the selected tracking record's futures month.", elem: $futuresMonthButton, field: 'futures_month'});
			}
		}
		// Roll Date must be >= the tracking record's Sale Date
		if (currentActionRecord && currentActionRecord.sale_date && sale_date) {
			const recordDate = moment(currentActionRecord.sale_date).startOf('day');
			const selectedDate = moment(sale_date).startOf('day');
			if (selectedDate.isBefore(recordDate)) {
				errors.push({err: 'Roll Date must be on or after the tracking record Sale Date.', elem: $saleDate, field: 'sale_date'});
			}
		}
	}
	if (currentActionStatus === 'Set') {
		if (sale_type === 'HTA' && (!basis_price || basis_price === '')) {
			errors.push({err:'Basis Price is required.', elem: $basisPrice, field: 'basis_price'});
		}
		if (sale_type === 'Basis' && (!futures_price || futures_price === '')) {
			errors.push({err:'Futures Price is required.', elem: $futuresPrice, field: 'futures_price'});
		}
		if (!delivery_month) {
			errors.push({err:'Delivery Month is required.', elem: $deliveryMonth, field: 'delivery_month'});
		}
		if (!delivery_location || delivery_location.trim() === '') {
			errors.push({err:'Delivery Location is required.', elem: $deliveryLocation, field: 'delivery_location'});
		}
		// Delivery Date (sale_date) must be >= the tracking record's Sale Date
		if (currentActionRecord && currentActionRecord.sale_date && sale_date) {
			const recordDate = moment(currentActionRecord.sale_date).startOf('day');
			const selectedDate = moment(sale_date).startOf('day');
			if (selectedDate.isBefore(recordDate)) {
				errors.push({err:'Delivery Date must be on or after the tracking record Sale Date.', elem: $saleDate, field: 'sale_date'});
			}
		}
	}

	// Sale type specific validation (skip for Set/Roll actions)
	if (!currentActionStatus) {
		if (sale_type == 'Cash') {
			if (!delivery_month) {
				errors.push({err:'Delivery Month is required.', elem: $deliveryMonth, field: 'delivery_month'});
			}
			if (!futures_price || futures_price === '') {
				errors.push({err:'Futures Price is required.', elem: $futuresPrice, field: 'futures_price'});
			}
			if (!basis_price || basis_price === '') {
				errors.push({err:'Basis Price is required.', elem: $basisPrice, field: 'basis_price'});
			}
			if (!delivery_location || delivery_location.trim() === '') {
				errors.push({err:'Delivery Location is required.', elem: $deliveryLocation, field: 'delivery_location'});
			}
		}
		else if (sale_type == 'HTA') {
			if (!nearby_futures_month) {
				// For custom dropdown, validate the hidden input and highlight the button
				const $nearbyFuturesMonthButton = $('#nearbyFuturesMonthSelector');
				errors.push({err:'Comp. Fut. Month is required.', elem: $nearbyFuturesMonthButton, field: 'nearby_futures_month'});
			}
			if (!initial_basis_price || initial_basis_price === '') {
				errors.push({err:'Initial Basis Price is required.', elem: $initialBasisPrice, field: 'initial_basis_price'});
			}
			if (!futures_price || futures_price === '') {
				errors.push({err:'Futures Price is required.', elem: $futuresPrice, field: 'futures_price'});
			}
			if (!hta_contract_holder || hta_contract_holder.trim() === '') {
				errors.push({err:'HTA Contract Holder is required.', elem: $htaContractHolder, field: 'hta_contract_holder'});
			}
		}
		else if (sale_type == 'Basis') {
			if (!basis_price || basis_price === '') {
				errors.push({err:'Basis Price is required.', elem: $basisPrice, field: 'basis_price'});
			}
			if (!basis_contract_holder || basis_contract_holder.trim() === '') {
				errors.push({err:'Basis Contract Holder is required.', elem: $basisContractHolder, field: 'basis_contract_holder'});
			}
		}
	}

	// Validate storage location deduction if checkbox is checked
	const $deductFromStorage = $('#deduct_from_storage');
	const $storageLocation = $('#storage_location');
	if ($deductFromStorage.is(':checked')) {
		const selectedStorageLocation = $storageLocation.val();
		if (!selectedStorageLocation || selectedStorageLocation === '') {
			errors.push({err:'Storage Location is required when deducting from inventory.', elem: $storageLocation, field: 'storage_location'});
		}
		// Quantity validation is already handled above, but we can add a specific message
		if (!quantity || quantity <= 0) {
			// This error is already added, but we ensure it's clear
		}
	}

	// Display validation errors
	if (errors.length > 0) {
		errors.forEach(function(error) {
			const $elem = error.elem && error.elem.jquery ? error.elem : $(error.elem);
			if (!$elem || !$elem.length) return;
			// Add invalid class to the field (works for inputs, selects, and buttons)
			$elem.addClass('is-invalid');
			
			// Find the parent container and add error message
			let $parent = $elem.closest('.my-3, .dropdown');
			if (!$parent.length) {
				// If no parent found, try finding the label's parent
				$parent = $elem.closest('.col').find('.my-3, .dropdown').first();
			}
			if ($parent.length) {
				// Check if error message already exists
				if ($parent.find('.invalid-feedback').length === 0) {
					$parent.append('<div class="invalid-feedback d-block">' + error.err + '</div>');
				}
			}
		});
		
		// Scroll to first error and focus (if it's focusable)
		const firstError = errors.find(err => err.elem && err.elem.length);
		const firstElem = firstError ? firstError.elem[0] : null;
		if (firstElem && typeof firstElem.focus === 'function') {
			firstError.elem.focus();
		} else {
			// For buttons, scroll to them instead
			firstElem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
		
		// Scroll modal to show first error
		const modalBody = document.querySelector('#salesModal .modal-body');
		if (modalBody) {
			modalBody.scrollTop = 0;
		}
		
		return;
	}
	else {

		let status = 'Created';
		if (id) {
			status = 'Updated';
		}
		if (currentActionStatus) {
			status = currentActionStatus;
		}
		
		// updated_at is set on every create/update and used exclusively for Last Updated display
		const now = moment().toISOString();
		const source_id = (currentActionStatus === 'Set' || currentActionStatus === 'Rolled') && currentActionRecord
			? currentActionRecord.id
			: null;
		const record = {
			id: id,
			parent_id: parent_id,
			source_id: source_id,
			sale_date: sale_date,
			sale_type: sale_type,
			status: status,
			quantity: quantity,
			futures_month: futures_month,
			futures_price: futures_price,
			basis_price: basis_price,
			service_fee: service_fee,
			cash_price: cash_price,
			delivery_month: delivery_month,
			comments: comments,
			merch_gain: merch_gain,
			nearby_futures_month: nearby_futures_month,
			nearby_futures_price: nearby_futures_price,
			hta_contract_holder: hta_contract_holder,
			basis_contract_holder: basis_contract_holder,
			delivery_location: delivery_location,
			initial_basis_price: initial_basis_price,
			carry: carry,
			updated_at: now
		};
		
		if (!id) {
			// New record - auto-increment ID
			let next_id = 0;
			for (var i = 0; i < sales_data.length; i++) {
				if (sales_data[i].id > next_id) next_id = sales_data[i].id;
			}
			next_id++;
			record.id = next_id;
				record.status = currentActionStatus || 'Created';
				sales_data.push(record);
				saveSalesData();
			// For new top-level Add Sale: collapse all, expand only the new record
			if (!record.parent_id) {
				expandedSaleId = record.id;
				newlyAddedSaleId = record.id;
			}
			console.log('New record added:', record);
			console.log('All sales_data:', sales_data);
		} else {
			// Update existing record
			const recordIndex = sales_data.findIndex(sale => sale.id === id);
			if (recordIndex !== -1) {
				const existing = sales_data[recordIndex];
				// First/origin record (no parent) keeps Action "Created" unless it's a Cash sale, then "Set"
				if (!existing.parent_id && sale_type !== 'Cash') {
					record.status = 'Created';
				} else {
					record.status = currentActionStatus || 'Updated';
				}
				sales_data[recordIndex] = record;
				saveSalesData();
				console.log('Record updated:', record);
				console.log('All sales_data:', sales_data);
			} else {
				console.error('Record with id', id, 'not found in sales_data');
			}
		}
		
		// Refresh the table and close modal
		renderSalesTable();
		allowModalClose = true;
		$('#salesModal').modal('hide');
		
	}
	
}

$(document).ready(function() {
	populateDeliveryLocationOptions();

	// Show delivery/location options on focus (prototype: avoid needing two clicks)
	$('#delivery_location, #hta_contract_holder, #basis_contract_holder').on('focus', function() {
		var el = this;
		setTimeout(function() {
			el.dispatchEvent(new Event('input', { bubbles: true }));
			// Simulate second click so datalist opens on first focus (e.g. Contract Holder fields)
			el.click();
		}, 10);
	});

	// Update "Last Updated" relative times every minute
	setInterval(function() {
		$('[data-last-updated]').each(function() {
			var ts = $(this).attr('data-last-updated');
			var $cell = $(this).find('._cell');
			if (!$cell.length) return;
			$cell.text(ts ? formatRelativeDate(ts) : '--');
		});
	}, 60000);

	$('input[type="number"].dec0').on('blur', function () {
		const v = parseFloat(this.value);
		if (!isNaN(v)) this.value = v.toFixed(0);
	});

	$('input[type="number"].dec4').on('blur', function () {
		const v = parseFloat(this.value);
		if (!isNaN(v)) this.value = v.toFixed(4);
	});

	// Calculate Cash Price: futures_price + basis_price - service_fee
	function calculateCashPrice() {
	let futuresPrice = parseFloat($('#futures_price').val());
	if (Number.isNaN(futuresPrice)) {
		const referencePrice = parseFloat($('#futures_price_reference').val());
		futuresPrice = Number.isNaN(referencePrice) ? 0 : referencePrice;
	}
		const basisPrice = parseFloat($('#basis_price').val()) || 0;
		const serviceFee = parseFloat($('#service_fee').val()) || 0;
		const carryPrice = parseFloat($('#carry').val()) || 0;
		
		const cashPrice = futuresPrice + basisPrice + carryPrice - serviceFee;
		$('#cash_price').val(cashPrice.toFixed(4));
	}

	// Update cash price when any of the component fields change
	$('#futures_price, #futures_price_reference, #basis_price, #service_fee, #carry').on('input change blur', calculateCashPrice);

  	window.sales_date_picker = new tempusDominus.TempusDominus($('#sale_date_select')[0], {
		display: {
			components: {
				calendar: true,
				date: true,
				month: true,
				year: true,
				decades: true,
				clock: false,
				hours: false,
				minutes: false,
				seconds: false
			}
		},
		stepping: 1,
		localization: {
			format: 'yyyy-MM-dd',
			dayViewHeaderFormat: { month: 'long', year: 'numeric' }
		}
  	});
	//sales_date_picker.dates.formatInput = function(date) {
	//	return moment(date).format("YYYY-MM-DD"); // requires moment.js
	//};
	
	const delivery_month_picker = new tempusDominus.TempusDominus($('#delivery_month_select')[0], {
		display: {
			viewMode: 'calendar',
			components: {
				decades: true,
				year: true,
				month: true,
				date: false,
				hours: false,
				minutes: false,
				seconds: false
			}
		},
		stepping: 1,
		localization: {
			format: 'yyyy-MM',
			dayViewHeaderFormat: { month: 'long', year: 'numeric' }
		}
	});

	// Track active picker and close others when one opens
	let activePicker = null;

	window.sales_date_picker.subscribe(tempusDominus.Namespace.events.show, () => {
		if (activePicker && activePicker !== window.sales_date_picker) {
			activePicker.hide();
		}
		activePicker = window.sales_date_picker;
	});

	window.sales_date_picker.subscribe(tempusDominus.Namespace.events.hide, () => {
		if (activePicker === window.sales_date_picker) {
			activePicker = null;
		}
	});

	delivery_month_picker.subscribe(tempusDominus.Namespace.events.show, () => {
		if (activePicker && activePicker !== delivery_month_picker) {
			activePicker.hide();
		}
		activePicker = delivery_month_picker;
	});

	delivery_month_picker.subscribe(tempusDominus.Namespace.events.hide, () => {
		if (activePicker === delivery_month_picker) {
			activePicker = null;
		}
	});


	// Initialize tips
	const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
	const popoverList = [...popoverTriggerList].map(el => new bootstrap.Popover(el, {
		trigger: 'click',
		html: true
	}));
	
	// Native BS tips were cool, but I didn't like you had to click the handle again to close.
	// So I created this bubble listener to intuitively close tips when the user clicks.
	document.addEventListener('click', function (e) {
		popoverList.forEach(pop => {
			if (
				pop._element !== e.target &&            // clicked somewhere else
				!pop._element.contains(e.target) &&     // not inside the popover trigger
				document.querySelector('.popover') &&   // a popover exists
				!document.querySelector('.popover').contains(e.target) // not inside popover itself
			) {
				pop.hide();
			}
		});
	});
	
	$('#salesModal').on('shown.bs.modal', function () {
		isInitializingModal = true;
		allowModalClose = false;
		modalIsDirty = false;
		if (modalInitTimer) {
			clearTimeout(modalInitTimer);
		}
		modalInitTimer = setTimeout(function() {
			modalInitialState = normalizeModalState(getSalesModalState());
			modalIsDirty = false;
			isInitializingModal = false;
		}, 400);
		// Populate futures options for action modes
		if (currentActionMode) {
			populatFutureSelection();
			return;
		}
		// Only populate futures and clear form if we're creating a new record (no sale_id)
		if (!$('#sale_id').val()) {
			populatFutureSelection();
			clearSalesForm();
		}
		// If editing, editSaleLedger handles populating futures options
	});
	
	$('#salesModal').on('hidden.bs.modal', function () {
		if (modalInitTimer) {
			clearTimeout(modalInitTimer);
			modalInitTimer = null;
		}
		isInitializingModal = false;
		allowModalClose = false;
		modalIsDirty = false;
		clearSalesForm();
	});

	// Show tooltip when typing starts in location fields
	const locationFields = ['hta_contract_holder', 'basis_contract_holder', 'delivery_location'];
	locationFields.forEach(function(fieldId) {
		const $input = $('#' + fieldId);
		const $tooltip = $('#' + fieldId + '_tooltip');
		
		$input.on('input', function() {
			if ($input.val().length > 0) {
				$tooltip.fadeIn(200);
			} else {
				$tooltip.fadeOut(200);
			}
		});
		
		$input.on('blur', function() {
			$tooltip.fadeOut(200);
		});
	});

	// Storage location deduction functionality
	function updateStorageSummary() {
		const $checkbox = $('#deduct_from_storage');
		const $section = $('#storage_location_section');
		const $dropdown = $('#storage_location');
		const $summary = $('#storage_summary');
		const $quantity = $('#quantity');
		
		// Show/hide section based on checkbox
		if ($checkbox.is(':checked')) {
			$section.removeClass('hideByDefault').addClass('_show');
		} else {
			$section.removeClass('_show').addClass('hideByDefault');
			$dropdown.val('');
			$summary.hide();
		}
		
		// Calculate and display summary
		const selectedLocation = $dropdown.val();
		const quantity = parseSetQuantityInput($quantity.val()) || 0;
		
		// Check if checkbox is checked and location is selected
		if ($checkbox.is(':checked') && selectedLocation) {
			if (quantity <= 0) {
				// Show validation message if quantity is missing
				const validationText = 'Please enter the quantity bushels for this sale.';
				$summary.find('.storage-summary-text').text(validationText);
				$summary.css({display: 'flex', opacity: 0}).animate({opacity: 1}, 200);
			} else {
				// Parse inventory amount from storage location string
				// Format: "Home Bins: CORN 2026 / 110,000 bu."
				const match = selectedLocation.match(/\/(\s*[\d,]+)\s*bu\./);
				if (match) {
					const currentInventory = parseFloat(match[1].replace(/,/g, '')) || 0;
					let newInventory = currentInventory - quantity;
					
					// If new inventory < 0, make it 0
					if (newInventory < 0) {
						newInventory = 0;
					}
					
					// Format numbers with commas
					const formatNumber = (num) => {
						return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
					};
					
					const summaryText = `Proceeding will deduct ${formatNumber(quantity)} bu. from ${selectedLocation}, making the new inventory allocation: ${formatNumber(newInventory)} bu.`;
					$summary.find('.storage-summary-text').text(summaryText);
					$summary.css({display: 'flex', opacity: 0}).animate({opacity: 1}, 200);
				}
			}
		} else {
			$summary.animate({opacity: 0}, 200, function() {
				$(this).css('display', 'none');
			});
		}
	}
	
	// Handle checkbox change
	$('#deduct_from_storage').on('change', updateStorageSummary);
	
	// Handle storage location dropdown change
	$('#storage_location').on('change', updateStorageSummary);
	
	// Handle quantity input change and format on blur (whole number, comma)
	$('#quantity').on('input change', updateStorageSummary).on('blur', function() {
		const $q = $(this);
		const raw = parseSetQuantityInput($q.val());
		if (!Number.isNaN(raw) && raw >= 0) {
			$q.val(formatSetQuantity(Math.floor(raw)));
		}
	});

	// Clear validation errors when user interacts with fields
	function clearFieldValidation($field) {
		$field.removeClass('is-invalid');
		const $parent = $field.closest('.my-3, .dropdown');
		if ($parent.length) {
			$parent.find('.invalid-feedback').remove();
		}
	}

	// Add event listeners to clear validation on input/change
	// Location fields: only clear when value is entered (not on focus/empty input)
	const locationFieldIds = ['delivery_location', 'hta_contract_holder', 'basis_contract_holder'];
	$('#salesModal').on('input change', '.form-control, .form-select', function() {
		if (isInitializingModal) return;
		const currentState = normalizeModalState(getSalesModalState());
		modalIsDirty = currentState !== modalInitialState;
		const $field = $(this);
		const fieldId = $field.attr('id');
		if (locationFieldIds.includes(fieldId)) {
			// Only clear when user has entered/selected a value
			const val = ($field.val() || '').trim();
			if (val === '') return;
		}
		clearFieldValidation($field);
	});

	// Delivery Month and Sale Date use TempusDominus; clear validation when picker closes (value selected)
	delivery_month_picker.subscribe(tempusDominus.Namespace.events.hide, () => {
		clearFieldValidation($('#delivery_month'));
	});
	window.sales_date_picker.subscribe(tempusDominus.Namespace.events.hide, () => {
		clearFieldValidation($('#sale_date'));
	});
	
	$('#set_quantity').on('input change', function() {
		updateSetQuantityFromValue($(this).val());
	});
	$('#set_quantity_input').on('input change', function() {
		clearSetQuantityValidation();
		updateSetQuantityFromValue($(this).val());
	}).on('blur', function() {
		const clamped = clampSetQuantity($(this).val());
		$(this).val(formatSetQuantity(clamped));
		$('#set_quantity').val(clamped);
	});
	$('#setQuantityBtn').on('click', function() {
		if (!currentSetRecord && !currentRollRecord) return;
		clearSetQuantityValidation();
		const result = validateSetQuantityInput();
		if (!result.valid) {
			const $input = $('#set_quantity_input');
			$input.addClass('is-invalid');
			const $row = $input.closest('.set-quantity-input-row');
			$row.find('.invalid-feedback').remove();
			$row.append('<div class="invalid-feedback d-block">' + result.message + '</div>');
			$input.focus();
			return;
		}
		const qty = parseSetQuantityInput($('#set_quantity_input').val());
		const setModal = bootstrap.Modal.getInstance(document.getElementById('setQuantityModal'));
		if (setModal) setModal.hide();
		setTimeout(function() {
			if (currentSetRecord) {
				openActionModal('Set', currentSetRecord, qty);
			} else if (currentRollRecord) {
				openActionModal('Roll', currentRollRecord, qty);
			}
			currentSetRecord = null;
			currentRollRecord = null;
		}, 200);
	});

	// Clear validation when custom dropdown buttons are clicked or when selections are made
	$('#futuresMonthSelector, #nearbyFuturesMonthSelector').on('click', function() {
		clearFieldValidation($(this));
	});

	// Enter key submits the current modal form
	$(document).on('keydown', function(e) {
		if (e.key !== 'Enter') return;
		const $setModal = $('#setQuantityModal');
		const $salesModal = $('#salesModal');
		if ($setModal.hasClass('show')) {
			e.preventDefault();
			$('#setQuantityBtn').trigger('click');
			return;
		}
		if ($salesModal.hasClass('show')) {
			e.preventDefault();
			const $primary = $('#salesModal .btn-primary:visible').first();
			if ($primary.length) {
				$primary.trigger('click');
			}
		}
	});

	// Handle futures month selections (event delegation for dynamic options)
	$(document).on('click', '#futures_month_options li, #nearby_futures_month_options li', function(e) {
		e.preventDefault();
		const $li = $(this);
		if ($li.hasClass('futures-month-disabled')) return false;
		const $ul = $li.closest('ul');
		const $a = $li.find('a');
		const futuresMonth = $li.data('futures_month') || $li.attr('data-futures-month');
		const futuresPrice = $li.data('futures_price') ?? $li.attr('data-futures-price');
		const smTxt = $li.data('sm_txt') || $li.attr('data-sm-txt');
		
		if ($ul.attr('id') === 'futures_month_options') {
			clearFieldValidation($('#futuresMonthSelector'));
			if (futuresMonth) {
				$('#futures_month').val(futuresMonth);
			}
			if (futuresPrice !== undefined && futuresPrice !== null && futuresPrice !== '') {
				const priceValue = parseFloat(futuresPrice);
				if (!Number.isNaN(priceValue)) {
					const saleType = $('#sale_type').val();
					if (saleType === 'Basis') {
						$('#futures_price_reference').val(priceValue.toFixed(4));
						$('#futures_price').val('');
					} else {
						$('#futures_price').val(priceValue.toFixed(4));
						$('#futures_price_reference').val(priceValue.toFixed(4));
					}
					// Roll (HTA or Basis): auto-populate Carry = New Futures Price - Origin Futures Price
					if (currentActionStatus === 'Rolled' && currentActionRecord) {
						const origin = getOriginRecord(currentActionRecord);
						const originFuturesPrice = origin && origin.futures_price != null && origin.futures_price !== ''
							? parseFloat(origin.futures_price)
							: NaN;
						if (!Number.isNaN(originFuturesPrice)) {
							const carry = priceValue - originFuturesPrice;
							$('#carry').val(carry.toFixed(4));
						}
					}
				}
			}
			if (smTxt) {
				$('#futures_price_as_of').html('As of ' + moment(smTxt).subtract(1, 'day').format('MMM DD, YYYY'));
			}
			$('#futuresMonthSelector').html($a.html());
			// Trigger cash price calculation
			$('#futures_price').trigger('input');
			$('#carry').trigger('input');
		}
		
		if ($ul.attr('id') === 'nearby_futures_month_options') {
			clearFieldValidation($('#nearbyFuturesMonthSelector'));
			if (futuresMonth) {
				$('#nearby_futures_month').val(futuresMonth);
			}
			if (futuresPrice !== undefined && futuresPrice !== null && futuresPrice !== '') {
				const priceValue = parseFloat(futuresPrice);
				if (!Number.isNaN(priceValue)) {
					$('#nearby_futures_price').val(priceValue);
					$('#nearby_futures_price_txt').html('Captured Fut. Price: ' + priceValue);
				}
			}
			$('#nearbyFuturesMonthSelector').html($a.html());
		}
		
		const $button = $li.closest('.dropdown').find('button');
		clearFieldValidation($button);
	});

	// Special handling for dropdowns and hidden inputs
	$('#sale_type').on('change', function() {
		clearFieldValidation($(this));
		// Clear all validation when sale type changes
		$('#salesModal .form-control, #salesModal .form-select, #salesModal .btn').removeClass('is-invalid');
		$('#salesModal .invalid-feedback').remove();
	});

	// Confirm before closing if form has changes
	$('#salesModal').on('hide.bs.modal', function (e) {
		if (allowModalClose) return;
		if (!modalIsDirty) return;
		e.preventDefault();
		const shouldExit = window.confirm('Exit without saving?');
		if (shouldExit) {
			allowModalClose = true;
			$('#salesModal').modal('hide');
		}
	});

	// Render sales table on page load
	sales_data = loadSalesData();
	renderSalesTable();

	// Handle delete confirmation
	$('#confirmDeleteBtn').on('click', function() {
		const id = $('#deleteConfirmModal').data('deleteId');
		const hasChildren = $('#deleteConfirmModal').data('hasChildren');
		
		if (hasChildren) {
			// Delete all child records first
			sales_data = sales_data.filter(sale => sale.parent_id !== id);
		}
		
		// Delete the record
		sales_data = sales_data.filter(sale => sale.id !== id);
		saveSalesData();
		
		console.log('Record deleted:', id);
		console.log('Remaining sales_data:', sales_data);
		
		// Hide the modal
		const deleteModal = bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'));
		deleteModal.hide();
		
		// Refresh the table
		renderSalesTable();
	});

});

function clearSalesForm(){
	$('#salesModal input, #salesModal textarea, #salesModal select').val('');
	$('#sale_id').val('');
	$('#parent_id').val('');
	$('#futuresMonthSelector').html('-Select-');
	$('#nearbyFuturesMonthSelector').html('-Select-');
	$('.sm_txt').empty();
	
	// Clear validation errors
	$('#salesModal .form-control, #salesModal .form-select').removeClass('is-invalid');
	$('#salesModal .invalid-feedback').remove();
	
	// Reset storage location section
	$('#deduct_from_storage').prop('checked', false);
	$('#storage_location_section').removeClass('_show').addClass('hideByDefault');
	$('#storage_summary').css('display', 'none');
	
	// Set sale_date to today
	const today = moment().format('YYYY-MM-DD');
	$('#sale_date').val(today);
	// Trigger input event to sync with picker
	$('#sale_date').trigger('input');
	
	// Reset button text to "Save"
	$('#saveSaleBtn').text('Save');
	$('#modalTitle').text(defaultModalTitle);
	$('#modalSubtitle').text('Add Sale');
	
	checkSalesType();
	resetActionState();
};

function checkSalesType(){
	const saleType = $('#sale_type').val();
	const $futuresPriceElem = $('#futures_price_elem');
	const $basisPriceElem = $('#basis_price_elem');
	const $deliveryMonthElem = $('#delivery_month_elem');
	const $deliveryLocationElem = $('#delivery_location_elem');
	const $nearbyFuturesMonthElem = $('#nearby_futures_month_elem');
	const $initialBasisPriceElem = $('#initial_basis_price_elem');
	const $carryElem = $('#carry_elem');
	const $deliveryLocationLabel = $('label[for="delivery_location"]');
	const merchTipEl = document.getElementById('merch_gain_tip');
	const setFieldDisabled = ($elem, isDisabled) => {
		$elem.toggleClass('field-disabled', isDisabled);
		$elem.find('input, select, textarea').prop('disabled', isDisabled);
	};
	const syncDropdownDisabled = () => {
		const futuresDisabled = $('#futures_month').prop('disabled');
		const nearbyDisabled = $('#nearby_futures_month').prop('disabled');
		$('#futuresMonthSelector')
			.prop('disabled', futuresDisabled)
			.toggleClass('disabled', futuresDisabled);
		$('#nearbyFuturesMonthSelector')
			.prop('disabled', nearbyDisabled)
			.toggleClass('disabled', nearbyDisabled);
	};
	const updateMerchGainTip = () => {
		if (!merchTipEl) return;
		const label = saleType ? `${saleType} ` : '';
		const content = `If this ${label}sale has been advised, and there is a direct per-bushel advantage, enter a value here.`;
		merchTipEl.setAttribute('data-bs-content', content);
		const pop = bootstrap.Popover.getInstance(merchTipEl);
		if (pop && typeof pop.setContent === 'function') {
			pop.setContent({ '.popover-body': content });
		}
	};
	
	// Hide all required asterisks first (except Sales Type which is always required)
	$('.required-asterisk').addClass('required-asterisk-hidden');
	// Always show Sales Type asterisk since it's always required
	$('#sale_type').closest('.my-3').find('.required-asterisk').removeClass('required-asterisk-hidden');
	
	if (saleType == '') {
		$('.hideByDefault').removeClass('_show');
		updateMerchGainTip();
		if ($deliveryLocationLabel.length) {
			$deliveryLocationLabel.contents().first()[0].textContent = 'Delivery Location';
		}
		// Reset deduct section
		$('#deduct_from_storage').prop('checked', false);
		$('#storage_location').val('');
		$('#storage_summary').css('display', 'none');
	}
	else {

		$('#sales_form_elem').addClass('_show');
		updateMerchGainTip();
		$futuresPriceElem.removeClass('_show').removeClass('layout-spacer');
		$basisPriceElem.removeClass('_show').removeClass('layout-spacer');
		$deliveryMonthElem.removeClass('_show').removeClass('layout-spacer');
		$deliveryLocationElem.removeClass('_show').removeClass('layout-spacer');
		$nearbyFuturesMonthElem.removeClass('_show').removeClass('layout-spacer');
		$initialBasisPriceElem.removeClass('_show').removeClass('layout-spacer');
		$carryElem.removeClass('_show').removeClass('layout-spacer');
		if ($deliveryLocationLabel.length) {
			$deliveryLocationLabel.contents().first()[0].textContent = 'Delivery Location';
		}
		setFieldDisabled($futuresPriceElem, false);
		setFieldDisabled($basisPriceElem, false);
		setFieldDisabled($deliveryMonthElem, false);
		setFieldDisabled($deliveryLocationElem, false);
		setFieldDisabled($carryElem, false);
		setFieldDisabled($nearbyFuturesMonthElem, false);
		setFieldDisabled($initialBasisPriceElem, false);
		syncDropdownDisabled();

		// Show/hide elements based on sale type
		if (saleType == 'HTA') {
			$('#hta_contract_holder_elem').addClass('_show');
			$nearbyFuturesMonthElem.addClass('_show');
			$initialBasisPriceElem.addClass('_show');
			$futuresPriceElem.addClass('_show');
			$basisPriceElem.addClass('_show');
			$deliveryMonthElem.addClass('_show');
			$deliveryLocationElem.addClass('_show');
			if ($deliveryLocationLabel.length) {
				$deliveryLocationLabel.contents().first()[0].textContent = 'HTA Delivery Location';
			}
			if (currentActionStatus === 'Set') {
				setFieldDisabled($nearbyFuturesMonthElem, true);
				setFieldDisabled($initialBasisPriceElem, true);
				setFieldDisabled($basisPriceElem, false);
				setFieldDisabled($deliveryMonthElem, false);
				setFieldDisabled($deliveryLocationElem, false);
				$('#req_delivery_month').removeClass('required-asterisk-hidden');
				$('#req_delivery_location').removeClass('required-asterisk-hidden');
			} else {
				setFieldDisabled($basisPriceElem, true);
				setFieldDisabled($deliveryMonthElem, true);
				setFieldDisabled($deliveryLocationElem, true);
				$('#basis_price').val('');
				$('#delivery_month').val('');
				$('#delivery_location').val('');
			syncDropdownDisabled();
			}
			// Required fields for HTA
			$('#req_nearby_futures_month').removeClass('required-asterisk-hidden');
			$('#req_initial_basis_price').removeClass('required-asterisk-hidden');
			$('#req_sale_date').removeClass('required-asterisk-hidden');
			$('#req_futures_month').removeClass('required-asterisk-hidden');
			$('#req_quantity').removeClass('required-asterisk-hidden');
			$('#req_futures_price').removeClass('required-asterisk-hidden');
			$('#req_hta_contract_holder').removeClass('required-asterisk-hidden');
		}
		else {
			$('#hta_contract_holder_elem').removeClass('_show');
		};
		
		if (saleType == 'Cash') {
			$('#merch_gain_elem').addClass('_show');
			$futuresPriceElem.addClass('_show');
			$basisPriceElem.addClass('_show');
			$deliveryMonthElem.addClass('_show');
			$deliveryLocationElem.addClass('_show');
			// Show deduct section for Cash
			$('#deduct_section_divider').addClass('_show');
			$('#deduct_checkbox_section').addClass('_show');
			// Required fields for Cash
			$('#req_sale_date').removeClass('required-asterisk-hidden');
			$('#req_futures_month').removeClass('required-asterisk-hidden');
			$('#req_delivery_month').removeClass('required-asterisk-hidden');
			$('#req_quantity').removeClass('required-asterisk-hidden');
			$('#req_futures_price').removeClass('required-asterisk-hidden');
			$('#req_basis_price').removeClass('required-asterisk-hidden');
			$('#req_delivery_location').removeClass('required-asterisk-hidden');
			syncDropdownDisabled();
		}
		else {
			if (currentActionStatus === 'Set') {
				$('#deduct_section_divider').addClass('_show');
				$('#deduct_checkbox_section').addClass('_show');
			} else {
				// Hide deduct section for non-Cash sale types
				$('#deduct_section_divider').removeClass('_show');
				$('#deduct_checkbox_section').removeClass('_show');
				$('#storage_location_section').removeClass('_show');
				// Reset deduct checkbox and storage location
				$('#deduct_from_storage').prop('checked', false);
				$('#storage_location').val('');
				$('#storage_summary').css('display', 'none');
			}
		};
		
		// Merch Gain is optional for all sale types
		$('#merch_gain_elem').addClass('_show');
		
		if (saleType == 'Basis') {
			$('#basis_contract_holder_elem').addClass('_show');
			$nearbyFuturesMonthElem.addClass('_show').addClass('layout-spacer');
			$initialBasisPriceElem.addClass('_show').addClass('layout-spacer');
			$basisPriceElem.addClass('_show');
			$futuresPriceElem.addClass('_show');
			$deliveryMonthElem.addClass('_show');
			$deliveryLocationElem.addClass('_show');
			if ($deliveryLocationLabel.length) {
				$deliveryLocationLabel.contents().first()[0].textContent = 'Basis Delivery Location';
			}
			if (currentActionStatus === 'Set') {
				setFieldDisabled($futuresPriceElem, false);
				setFieldDisabled($deliveryMonthElem, false);
				setFieldDisabled($deliveryLocationElem, false);
				$('#req_delivery_month').removeClass('required-asterisk-hidden');
				$('#req_delivery_location').removeClass('required-asterisk-hidden');
				$('#req_futures_price').removeClass('required-asterisk-hidden');
			} else {
				setFieldDisabled($futuresPriceElem, true);
				setFieldDisabled($deliveryMonthElem, true);
				setFieldDisabled($deliveryLocationElem, true);
				$('#futures_price').val('');
				$('#delivery_month').val('');
				$('#delivery_location').val('');
			syncDropdownDisabled();
			}
			// Required fields for Basis
			$('#req_sale_date').removeClass('required-asterisk-hidden');
			$('#req_futures_month').removeClass('required-asterisk-hidden');
			$('#req_quantity').removeClass('required-asterisk-hidden');
			$('#req_basis_price').removeClass('required-asterisk-hidden');
			$('#req_basis_contract_holder').removeClass('required-asterisk-hidden');
		}
		else {
			$('#basis_contract_holder_elem').removeClass('_show');
		};
	}
};

const tabledata = [
	{
		id:1,
		sale_type:'HTA',
		sale_date:'2025-11-18'
	}
];

// Store futures data globally for lookup
let futuresDataByMonth = {};

const populatFutureSelection = async function() {
	const fdata = await getDailyFuturesForToday();
	//console.log(fdata);
	const fMonths = {};
	for (var i = 0; i < fdata.length; i++) {
		const m = fdata[i];
		if (m.specific_commodity == 'NORMAL') { // 5000 bu contracts
			const key = m.crop+'_'+m.futures_month;
			if (!fMonths[ key ]) {
				fMonths[ key ] = m;
			}
		}
	}

	// Store futures data by month (YYYY-MM format) for lookup
	futuresDataByMonth = {};
	for (let key in fMonths) {
		const monthKey = fMonths[key].futures_month.slice(0,7); // YYYY-MM
		futuresDataByMonth[monthKey] = fMonths[key];
	}

	const futures_month_options = $('#futures_month_options');
	const nearby_futures_month_options = $('#nearby_futures_month_options');
	
	futures_month_options.empty();
	nearby_futures_month_options.empty();
	
	// Sort fMonths by futures_month (YYYY-MM format) before creating options
	const sortedKeys = Object.keys(fMonths).sort(function(a, b) {
		const monthA = fMonths[a].futures_month.slice(0, 7); // YYYY-MM
		const monthB = fMonths[b].futures_month.slice(0, 7); // YYYY-MM
		return monthA.localeCompare(monthB);
	});
	
	let y = null;
	let alt = false;
	
	for (let key of sortedKeys) {
		
		const year = fMonths[key].futures_month.slice(0,4);
		const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+(fMonths[key].futures_month.slice(5,7)) - 1];
		
		const cal = $('<div>').addClass('calendar-icon')
					.append(
						$('<div>').addClass('year').html( year )
					)
					.append(
						$('<div>').addClass('month').html( month )
					);
		
		if (year != y) {
			y = year;
			alt = !alt;
		}
		
		if (alt) cal.addClass('_alt');
		
		const li = $('<li>')
			.attr('data-futures-month', fMonths[key].futures_month.slice(0,7))
			.attr('data-futures-price', fMonths[key].last)
			.attr('data-sm-txt', fMonths[key].date)
			.append(
				$('<a>')
					.addClass('dropdown-item')
					.addClass('cal-option')
					.attr('href','#')
				.append( cal )
			)
		;
		
		futures_month_options.append(li.clone(true));
		nearby_futures_month_options.append(li.clone(true));
	}
	
	// Ensure options are sorted (in case of any issues)
	sortFuturesMonthOptions(futures_month_options);
	sortFuturesMonthOptions(nearby_futures_month_options);
};

function clearAsOf(e){
	$('#'+e).empty();
}

function getDailyFuturesForToday() {
	// API: /api/external/market/futures/crop/[CROP]/daily
	return new Promise((resolve, reject) => {
		setTimeout(() => { // simulate an API delay for response
			fetch('./assets/daily-futures.json')
				.then((response) => {
					if (!response.ok) {
						throw new Error('Failed to load futures data');
					}
					return response.json();
				})
				.then((data) => resolve(data))
				.catch((error) => {
					console.error(error);
					resolve([]);
				});
		}, 300);
	});
}

function tableTipCloseCaptureHandler(e) {
	const $target = $(e.target);
	const isInsideTipOrPopover = $target.closest('.merch-value-tip, .avg-cash-price-tip, .final-sale-value-tip, .merch-value-popover, .avg-cash-price-popover, .final-sale-value-popover').length > 0;
	const hasOpenTablePopover = document.querySelector('.merch-value-popover.show, .avg-cash-price-popover.show, .final-sale-value-popover.show');
	if (hasOpenTablePopover && !isInsideTipOrPopover) {
		$('#sales_data .merch-value-tip, #sales_data .avg-cash-price-tip, #sales_data .final-sale-value-tip').each(function() {
			const popover = bootstrap.Popover.getInstance(this);
			if (popover) popover.hide();
		});
		e.stopPropagation();
		e.preventDefault();
	}
}

function expandSaleLedger(id){
	// Collapse all other open record groups first
	$('.sale_ledger').not('.sale_ledger-'+id).removeClass('_show');
	$('tr[data-sale-id]').not(`tr[data-sale-id="${id}"]`).removeClass('_parent-opened');
	
	// Toggle the clicked record group
	const e = $('.sale_ledger-'+id);
	const parentRow = $(`tr[data-sale-id="${id}"]`);
	if ($(e[0]).hasClass('_show')) {
		e.removeClass('_show');
		parentRow.removeClass('_parent-opened');
		expandedSaleId = null;
	}
	else {
		e.addClass('_show');
		parentRow.addClass('_parent-opened');
		expandedSaleId = id;
	}
}

function formatDate(dateString) {
	if (!dateString) return '--';
	return moment(dateString).format('MMM D, YYYY');
}

function formatRelativeDate(dateString) {
	if (!dateString) return '--';
	const date = moment(dateString);
	if (!date.isValid()) return '--';
	const now = moment();
	const minutes = now.diff(date, 'minutes');
	if (minutes < 60) {
		return minutes <= 1 ? '1 min ago' : `${minutes} mins ago`;
	}
	const hours = now.diff(date, 'hours');
	if (hours < 24) {
		return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
	}
	const days = now.diff(date, 'days');
	if (days < 7) {
		return days === 1 ? '1 day ago' : `${days} days ago`;
	}
	const weeks = now.diff(date, 'weeks');
	if (weeks < 4) {
		return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
	}
	const months = now.diff(date, 'months');
	if (months < 12) {
		return months === 1 ? '1 month ago' : `${months} months ago`;
	}
	return date.format('MMM D, YYYY');
}

function formatMonth(dateString) {
	if (!dateString) return '--';
	return moment(dateString).format('MMM YYYY');
}

function formatPrice(price) {
	if (price === null || price === undefined) return '--';
	return '$' + parseFloat(price).toFixed(4);
}

function formatQuantity(quantity) {
	if (!quantity) return '--';
	return quantity.toLocaleString() + ' bu.';
}

/** Format value for Merch Value breakdown: positive = green, negative = red with parens (no hyphen). */
function formatMerchValueDriver(val) {
	if (val == null || val === '') return null;
	const num = parseFloat(val);
	if (Number.isNaN(num)) return null;
	const txt = num < 0 ? `(${formatPrice(Math.abs(val))})` : formatPrice(val);
	const color = num < 0 ? '#ff7474' : '#77ff76';
	return { txt, color };
}

/** Build HTML table for Merch Value tip: Date, Action, Performance Driver, Value / bu., ordered by date, action, driver. */
function buildMerchValueBreakdownHtml(saleId) {
	const origin = sales_data.find(s => s.id === saleId);
	if (!origin) return '';
	const children = sales_data.filter(r => r.parent_id === saleId || r.id === saleId);
	const allRecords = [origin, ...children.filter(r => r.id !== origin.id)].sort((a, b) =>
		moment(a.sale_date || 0) - moment(b.sale_date || 0)
	);
	const driverOrder = ['Merch Gain', 'Service Fee', 'Carry', 'Net Initial Basis'];
	const rows = [];
	let totalMerchValue = 0;
	allRecords.forEach((rec) => {
		const isTopLevel = rec.id === origin.id;
		const originRec = getOriginRecord(rec);
		const action = origin && origin.sale_type === 'Cash'
			? (isTopLevel ? 'Set' : (rec.status === 'Set' || rec.status === 'Updated' ? 'Set' : rec.status === 'Rolled' ? 'Roll' : 'Pending'))
			: isTopLevel ? 'Created' : rec.status === 'Created' ? 'Created' : rec.status === 'Set' || rec.status === 'Updated' ? 'Set' : rec.status === 'Rolled' ? 'Roll' : 'Pending';
		const dateStr = formatDate(rec.sale_date);
		const drivers = [];
		// Merch Gain
		const mg = formatMerchValueDriver(rec.merch_gain);
		if (mg) drivers.push({ name: 'Merch Gain', ...mg });
		// Service Fee (subtracted in calc, show as negative when present)
		const sf = rec.service_fee != null && rec.service_fee !== '' ? parseFloat(rec.service_fee) : NaN;
		if (!Number.isNaN(sf)) {
			const sfFmt = formatMerchValueDriver(-Math.abs(sf)); // fees subtract, show as negative
			if (sfFmt) drivers.push({ name: 'Service Fee', ...sfFmt });
		}
		// Carry
		const carry = formatMerchValueDriver(rec.carry);
		if (carry) drivers.push({ name: 'Carry', ...carry });
		// Net Initial Basis (Set Basis - Initial Basis) for Set records
		const isSet = rec.status === 'Set' || rec.status === 'Updated';
		const hasInitBasis = originRec && (originRec.initial_basis_price != null && originRec.initial_basis_price !== '');
		if (isSet && hasInitBasis) {
			const setBasis = rec.basis_price != null && rec.basis_price !== '' ? parseFloat(rec.basis_price) : NaN;
			const initBasis = parseFloat(originRec.initial_basis_price);
			if (!Number.isNaN(setBasis) && !Number.isNaN(initBasis)) {
				const netBasis = setBasis - initBasis;
				const nb = formatMerchValueDriver(netBasis);
				if (nb) drivers.push({ name: 'Net Initial Basis', ...nb });
			}
		}
		// Sort drivers by driverOrder
		drivers.sort((a, b) => driverOrder.indexOf(a.name) - driverOrder.indexOf(b.name));
		const qty = (rec.quantity != null && rec.quantity !== '') ? (parseInt(rec.quantity, 10) || 0).toLocaleString() : '--';
		const futMonth = rec.futures_month ? formatMonth(rec.futures_month) : '--';
		drivers.forEach(d => rows.push({ date: dateStr, action, qty, futMonth, driver: d.name, txt: d.txt, color: d.color }));
	});
	// Recompute total from same formula as main table
	totalMerchValue = allRecords.reduce((sum, record) => {
		const merchGain = parseFloat(record.merch_gain);
		const carry = parseFloat(record.carry);
		const serviceFee = parseFloat(record.service_fee);
		let net = (Number.isNaN(merchGain) ? 0 : merchGain) + (Number.isNaN(carry) ? 0 : carry) - (Number.isNaN(serviceFee) ? 0 : serviceFee);
		const isSet = record.status === 'Set' || record.status === 'Updated';
		const originRec = getOriginRecord(record);
		if (isSet && originRec && (originRec.initial_basis_price != null && originRec.initial_basis_price !== '')) {
			const setBasis = parseFloat(record.basis_price);
			const initBasis = parseFloat(originRec.initial_basis_price);
			if (!Number.isNaN(setBasis) && !Number.isNaN(initBasis)) net += (setBasis - initBasis);
		}
		return sum + net;
	}, 0);
	const totalColor = totalMerchValue < 0 ? '#ff7474' : '#77ff76';
	const totalTxt = formatPrice(totalMerchValue);
	const rowHtml = rows.map(r => `<tr><td>${r.date}</td><td>${r.action}</td><td>${r.qty}</td><td>${r.futMonth}</td><td>${r.driver}</td><td style="text-align:right;color:${r.color}">${r.txt}</td></tr>`).join('');
	const summaryRow = `<tr><td colspan="5"><strong>Merch Value:</strong></td><td style="text-align:right;color:${totalColor}">${totalTxt}</td></tr>`;
	return `<div class="merch-value-tip-table" style="font-size:0.7rem"><table class="table table-sm table-borderless mb-0"><thead><tr><th>Date</th><th>Action</th><th>Qty (bu.)</th><th>Fut. Month</th><th>Driver</th><th style="text-align:right">Value / bu.</th></tr></thead><tbody>${rowHtml}${summaryRow}</tbody></table></div>`;
}

/** Build HTML table for Avg Cash Price tip: one row per Set record with Cash Price. */
function buildAvgCashPriceBreakdownHtml(saleId) {
	const origin = sales_data.find(s => s.id === saleId);
	if (!origin) return '';
	const children = sales_data.filter(r => r.parent_id === saleId || r.id === saleId);
	const allRecords = [origin, ...children.filter(r => r.id !== origin.id)].sort((a, b) =>
		moment(a.sale_date || 0) - moment(b.sale_date || 0)
	);
	const setRecords = origin.sale_type === 'Cash'
		? allRecords.filter(r => r.cash_price != null && r.cash_price !== '')
		: allRecords.filter(r => (r.status === 'Set' || r.status === 'Updated') && (r.cash_price != null && r.cash_price !== ''));
	if (setRecords.length === 0) return '';
	const rows = [];
	setRecords.forEach((rec) => {
		const cashPrice = parseFloat(rec.cash_price) || 0;
		const cpFmt = formatMerchValueDriver(cashPrice);
		const dateStr = formatDate(rec.sale_date);
		const qty = (rec.quantity != null && rec.quantity !== '') ? (parseInt(rec.quantity, 10) || 0).toLocaleString() : '--';
		const futMonth = rec.futures_month ? formatMonth(rec.futures_month) : '--';
		rows.push({ date: dateStr, action: 'Set', qty, futMonth, txt: cpFmt ? cpFmt.txt : '--', color: cpFmt ? cpFmt.color : '' });
	});
	const avgCashPrice = setRecords.reduce((s, r) => s + (parseFloat(r.cash_price) || 0), 0) / setRecords.length;
	const totalColor = avgCashPrice < 0 ? '#ff7474' : '#77ff76';
	const totalTxt = formatPrice(avgCashPrice);
	const rowHtml = rows.map(r => `<tr><td>${r.date}</td><td>${r.action}</td><td>${r.qty}</td><td>${r.futMonth}</td><td style="text-align:right;color:${r.color}">${r.txt}</td></tr>`).join('');
	const summaryRow = `<tr><td colspan="4" style="text-align:right"><strong>Avg. Cash Price:</strong></td><td style="text-align:right;color:${totalColor};font-weight:bold">${totalTxt}</td></tr>`;
	return `<div class="merch-value-tip-table" style="font-size:0.7rem"><table class="table table-sm table-borderless mb-0"><thead><tr><th>Date</th><th>Action</th><th>Qty (bu.)</th><th>Fut. Month</th><th style="text-align:right">Cash Price</th></tr></thead><tbody>${rowHtml}${summaryRow}</tbody></table></div>`;
}

/** Build HTML table for Final Sale Value tip: same as Avg Cash Price + Subtotal column (Qty * Cash Price). */
function buildFinalSaleValueBreakdownHtml(saleId) {
	const origin = sales_data.find(s => s.id === saleId);
	if (!origin) return '';
	const children = sales_data.filter(r => r.parent_id === saleId || r.id === saleId);
	const allRecords = [origin, ...children.filter(r => r.id !== origin.id)].sort((a, b) =>
		moment(a.sale_date || 0) - moment(b.sale_date || 0)
	);
	const setRecords = origin.sale_type === 'Cash'
		? allRecords.filter(r => r.cash_price != null && r.cash_price !== '')
		: allRecords.filter(r => (r.status === 'Set' || r.status === 'Updated') && (r.cash_price != null && r.cash_price !== ''));
	if (setRecords.length === 0) return '';
	const fmt = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const rows = [];
	setRecords.forEach((rec) => {
		const qtyNum = parseInt(rec.quantity || 0, 10) || 0;
		const cp = parseFloat(rec.cash_price) || 0;
		const subtotal = qtyNum * cp;
		const cashPrice = cp;
		const cpFmt = formatMerchValueDriver(cashPrice);
		const dateStr = formatDate(rec.sale_date);
		const qty = (rec.quantity != null && rec.quantity !== '') ? qtyNum.toLocaleString() : '--';
		const futMonth = rec.futures_month ? formatMonth(rec.futures_month) : '--';
		rows.push({ date: dateStr, action: 'Set', qty, futMonth, cashPriceTxt: cpFmt ? cpFmt.txt : '--', cashPriceColor: cpFmt ? cpFmt.color : '', subtotal: fmt(subtotal) });
	});
	const total = setRecords.reduce((s, r) => s + (parseInt(r.quantity || 0, 10) || 0) * (parseFloat(r.cash_price) || 0), 0);
	const rowHtml = rows.map(r => `<tr><td>${r.date}</td><td>${r.action}</td><td>${r.qty}</td><td>${r.futMonth}</td><td style="text-align:right;color:${r.cashPriceColor}">${r.cashPriceTxt}</td><td style="text-align:right">${r.subtotal}</td></tr>`).join('');
	const summaryRow = `<tr><td colspan="5" style="text-align:right"><strong>Final Sale Value:</strong></td><td style="text-align:right;font-weight:bold">${fmt(total)}</td></tr>`;
	return `<div class="merch-value-tip-table" style="font-size:0.7rem"><table class="table table-sm table-borderless mb-0"><thead><tr><th>Date</th><th>Action</th><th>Qty (bu.)</th><th>Fut. Month</th><th style="text-align:right">Cash Price</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${rowHtml}${summaryRow}</tbody></table></div>`;
}

function syncLedgerToolbarPosition($scroll) {
	const scrollLeft = $scroll.scrollLeft();
	$scroll.find('.ledger-action-toolbar').css('transform', `translate(${scrollLeft}px, -50%)`);
}

const getSalesRecord = async function(id){
	return sales_data.find(sale => sale.id === id);
}

function getSalesRecordSync(id) {
	return sales_data.find(sale => sale.id === id);
}

// Helper to read futures month value from option items
function getFuturesMonthValue($item) {
	return $item.data('futures_month') ?? $item.attr('data-futures-month');
}

// Helper to read futures price value from option items
function getFuturesPriceValue($item) {
	return $item.data('futures_price') ?? $item.attr('data-futures-price');
}

// Helper to read "as of" text from option items
function getFuturesSmTxtValue($item) {
	return $item.data('sm_txt') ?? $item.attr('data-sm-txt');
}

// Helper function to sort futures month options by YYYY-MM
function sortFuturesMonthOptions($ul) {
	const items = $ul.find('li').toArray();
	items.sort(function(a, b) {
		const monthA = getFuturesMonthValue($(a));
		const monthB = getFuturesMonthValue($(b));
		return monthA.localeCompare(monthB);
	});
	$ul.empty().append(items);
}

// Helper function to insert a futures month option in sorted position
function insertFuturesMonthOptionInOrder($ul, newOption) {
	const newMonth = getFuturesMonthValue(newOption);
	const items = $ul.find('li').toArray(); // Convert to array to avoid live collection issues
	
	// If list is empty, just append
	if (items.length === 0) {
		$ul.append(newOption);
		return;
	}
	
	// Find the correct position to insert
	let insertBefore = null;
	
	for (let i = 0; i < items.length; i++) {
		const monthValue = getFuturesMonthValue($(items[i]));
		if (newMonth < monthValue) {
			insertBefore = items[i];
			break;
		}
	}
	
	// Insert before the found element, or append if it should go at the end
	if (insertBefore) {
		$(insertBefore).before(newOption);
	} else {
		$ul.append(newOption);
	}
}

// Helper function to create a futures month option for edit form
function createFuturesMonthOptionForEdit(futuresMonth, futuresPrice, dateText) {
	// Convert to YYYY-MM format if needed
	let monthKey = futuresMonth;
	if (monthKey && monthKey.length > 7) {
		monthKey = monthKey.slice(0, 7);
	}
	
	const year = monthKey.slice(0, 4);
	const monthNum = parseInt(monthKey.slice(5, 7));
	const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][monthNum - 1];
	
	// Determine if alt class should be applied (check existing options for pattern)
	const existingOptions = $('#futures_month_options li');
	let useAlt = false;
	if (existingOptions.length > 0) {
		// Get the last option's year to determine pattern
		const lastYear = existingOptions.last().find('.year').text();
		const lastAlt = existingOptions.last().find('.calendar-icon').hasClass('_alt');
		// Alternate based on year change
		if (year !== lastYear) {
			useAlt = !lastAlt;
		} else {
			useAlt = lastAlt;
		}
	}
	
	const cal = $('<div>').addClass('calendar-icon');
	if (useAlt) cal.addClass('_alt');
	cal.append($('<div>').addClass('year').html(year));
	cal.append($('<div>').addClass('month').html(month));
	
	const li = $('<li>')
		.attr('data-futures-month', monthKey)
		.attr('data-futures-price', futuresPrice || '')
		.attr('data-sm-txt', dateText || moment().format('YYYY-MM-DD'))
		.append(
			$('<a>')
				.addClass('dropdown-item')
				.addClass('cal-option')
				.attr('href','#')
				.append(cal)
		);
	
	return li;
}

const editSaleLedger = async function(id){
	const record = await getSalesRecord(id);
	if (!record) {
		console.error('Record not found:', id);
		return;
	}
	
	console.log('Editing record:', record);
	
	// Set the record ID and parent_id
	$('#sale_id').val(record.id);
	$('#parent_id').val(record.parent_id || '');
	
	// Populate basic fields
	$('#sale_type').val(record.sale_type);
	$('#sale_date').val(record.sale_date);
	$('#quantity').val(record.quantity != null && record.quantity !== '' ? formatSetQuantity(parseInt(record.quantity, 10)) : '');
	$('#comments').val(record.comments || '');
	
	// Populate price fields
	if (record.futures_price !== null && record.futures_price !== undefined) {
		$('#futures_price').val(record.futures_price.toFixed(4));
		$('#futures_price_reference').val(record.futures_price.toFixed(4));
	} else {
		$('#futures_price').val('');
		$('#futures_price_reference').val('');
	}
	
	if (record.basis_price !== null && record.basis_price !== undefined) {
		$('#basis_price').val(record.basis_price.toFixed(4));
	} else {
		$('#basis_price').val('');
	}
	
	if (record.service_fee !== null && record.service_fee !== undefined) {
		$('#service_fee').val(record.service_fee.toFixed(4));
	} else {
		$('#service_fee').val('');
	}
	
	if (record.cash_price !== null && record.cash_price !== undefined) {
		$('#cash_price').val(record.cash_price.toFixed(4));
	} else {
		$('#cash_price').val('');
	}
	
	// Populate delivery month
	if (record.delivery_month) {
		$('#delivery_month').val(record.delivery_month);
	}
	
	// Populate sale type specific fields
	if (record.sale_type === 'HTA') {
		if (record.initial_basis_price !== null && record.initial_basis_price !== undefined) {
			$('#initial_basis_price').val(record.initial_basis_price.toFixed(4));
		} else {
			$('#initial_basis_price').val('');
		}
		
		if (record.hta_contract_holder) {
			$('#hta_contract_holder').val(record.hta_contract_holder);
		}
	}
	
	if (record.merch_gain !== null && record.merch_gain !== undefined) {
		$('#merch_gain').val(record.merch_gain.toFixed(4));
	} else {
		$('#merch_gain').val('');
	}
	
	if (record.sale_type === 'Cash') {
		if (record.delivery_location) {
			$('#delivery_location').val(record.delivery_location);
		}
	}
	
	if (record.sale_type === 'Basis') {
		if (record.basis_contract_holder) {
			$('#basis_contract_holder').val(record.basis_contract_holder);
		}
	}
	
	// Populate carry for Rolled records (so it's visible when editing)
	if (record.status === 'Rolled' && (record.carry !== null && record.carry !== undefined && record.carry !== '')) {
		$('#carry').val(typeof record.carry === 'number' ? record.carry.toFixed(4) : record.carry);
	} else {
		$('#carry').val('');
	}
	
	// For Set/Roll children, set action state so checkSalesType applies correct field restrictions
	const isSetOrRolled = record.status === 'Set' || record.status === 'Rolled' || record.status === 'Updated';
	const isSetOrRollChild = record.parent_id != null && isSetOrRolled;
	if (isSetOrRollChild) {
		currentActionStatus = (record.status === 'Rolled' ? 'Rolled' : 'Set');
		currentActionMode = (record.status === 'Rolled' ? 'roll' : 'set');
	}
	
	// Trigger checkSalesType to show/hide appropriate fields
	checkSalesType();
	
	// When editing a Rolled record, show the Carry field so user can view/edit it
	if (record.status === 'Rolled') {
		$('#carry_elem').removeClass('hideByDefault').addClass('_show');
		$('#req_carry').removeClass('required-asterisk-hidden');
		$('#carry').prop('disabled', false);
	}
	
	// Set/Rolled records: quantity is not editable
	$('#quantity').prop('disabled', isSetOrRolled);
	
	// When editing a Set or Roll child (not the origin), restrict fields to match what was editable when creating that action.
	// Origin-only fields (Comp. Fut. Month, Initial Basis Price, Contract Holder) must stay disabled.
	if (isSetOrRollChild && (record.sale_type === 'HTA' || record.sale_type === 'Basis')) {
		const origin = getOriginRecord(record);
		if (origin) {
			$('#nearby_futures_month, #initial_basis_price, #hta_contract_holder, #basis_contract_holder').prop('disabled', true);
			$('#initial_basis_price_elem, #hta_contract_holder_elem, #basis_contract_holder_elem').addClass('field-disabled');
			$('#nearby_futures_month_elem').addClass('field-disabled');
			$('#nearbyFuturesMonthSelector').prop('disabled', true).addClass('disabled');
			if (record.status === 'Set' || record.status === 'Updated') {
				$('#futures_month').prop('disabled', true);
				$('#futuresMonthSelector').closest('.dropdown').addClass('field-disabled');
				$('#futuresMonthSelector').prop('disabled', true).addClass('disabled');
				if (origin.sale_type === 'HTA') {
					$('#futures_price').prop('disabled', true);
					$('#futures_price_elem').addClass('field-disabled');
				}
				if (origin.sale_type === 'Basis') {
					$('#basis_price').prop('disabled', true);
					$('#basis_price_elem').addClass('field-disabled');
				}
			} else {
				// Rolled: futures_month and carry are editable; HTA Roll allows futures_price; Basis Roll allows basis_price
				$('#nearby_futures_month, #initial_basis_price, #hta_contract_holder, #basis_contract_holder').prop('disabled', true);
				if (origin.sale_type === 'HTA') {
					$('#basis_price').prop('disabled', true);
					$('#basis_price_elem').addClass('field-disabled');
					$('#nearby_futures_month_elem').addClass('field-disabled');
					$('#futures_price').prop('disabled', false);
					$('#futures_price_elem').removeClass('field-disabled');
				}
				if (origin.sale_type === 'Basis') {
					$('#futures_price').prop('disabled', true);
					$('#futures_price_elem').addClass('field-disabled');
					$('#basis_price').prop('disabled', false);
					$('#basis_price_elem').removeClass('field-disabled');
				}
			}
		}
	}
	
	// Update button text to "Save Changes"
	$('#saveSaleBtn').removeClass('hideByDefault');
	$('#splitSetBtn, #splitRollBtn').addClass('hideByDefault');
	$('#saveSaleBtn').text('Save Changes');
	$('#modalTitle').text(defaultModalTitle);
	$('#modalSubtitle').text(isSetOrRollChild ? `Edit Record: ${record.status === 'Rolled' ? 'Roll' : 'Set'}` : 'Edit Record');
	
	// Open the modal
	$('#salesModal').modal('show');
	
	// After modal is shown, populate futures options and select the correct ones
	$('#salesModal').one('shown.bs.modal', function() {
		// Populate futures options first
		populatFutureSelection();
		
		// Wait a bit for the DOM to update, then select them
		setTimeout(function() {
			// Convert record futures_month to YYYY-MM format for comparison
			let recordFuturesMonth = record.futures_month;
			if (recordFuturesMonth && recordFuturesMonth.length > 7) {
				recordFuturesMonth = recordFuturesMonth.slice(0, 7); // Convert '2025-11-01' to '2025-11'
			}
			
			// Populate futures month (custom dropdown)
			if (recordFuturesMonth) {
				let found = false;
				// Find and select the matching option in the dropdown
				const futuresMonthOptions = $('#futures_month_options li');
				futuresMonthOptions.each(function() {
				const monthValue = getFuturesMonthValue($(this));
					if (monthValue === recordFuturesMonth) {
						found = true;
						// Set the hidden input value
						$('#futures_month').val(monthValue);
						
						// Update the button display
						const a = $(this).find('a');
						$('#futuresMonthSelector').html(a.html());
						
						// Set the futures price and "as of" date
					const futuresPrice = getFuturesPriceValue($(this));
					const smTxt = getFuturesSmTxtValue($(this));
						
						// Only set futures price if not already set from record
						if (futuresPrice && (!$('#futures_price').val() || $('#futures_price').val() === '')) {
							const priceValue = parseFloat(futuresPrice);
							if (!Number.isNaN(priceValue)) {
								$('#futures_price').val(priceValue.toFixed(4));
							}
						}
						
						// Set "as of" date
						if (smTxt) {
							$('#futures_price_as_of').html('As of ' + moment(smTxt).subtract(1, "day").format("MMM DD, YYYY"));
						}
						
						// Trigger cash price calculation
						$('#futures_price').trigger('input');
						
						return false; // Break the loop
					}
				});
				
				// If not found, create and add the option in sorted position
				if (!found) {
					console.log('Futures month not found in dropdown, creating new option:', recordFuturesMonth);
					const newOption = createFuturesMonthOptionForEdit(
						record.futures_month,
						record.futures_price || null,
						record.sale_date || moment().format('YYYY-MM-DD')
					);
					
					// Insert into futures month options
					insertFuturesMonthOptionInOrder($('#futures_month_options'), newOption);
					console.log('Added to futures_month_options, total options:', $('#futures_month_options li').length);
					
					// Verify it was added
					const verifyOption = $('#futures_month_options li').filter(function() {
						return getFuturesMonthValue($(this)) === recordFuturesMonth;
					});
					console.log('Verification - found option after insert:', verifyOption.length > 0);
					
					// Also add to nearby futures month options in sorted position
					const newOptionCopy = createFuturesMonthOptionForEdit(
						record.futures_month,
						record.futures_price || null,
						record.sale_date || moment().format('YYYY-MM-DD')
					);
					insertFuturesMonthOptionInOrder($('#nearby_futures_month_options'), newOptionCopy);
					console.log('Added to nearby_futures_month_options, total options:', $('#nearby_futures_month_options li').length);
					
					// Now select it - use the newly added option
					const selectedOption = $('#futures_month_options li').filter(function() {
						return getFuturesMonthValue($(this)) === recordFuturesMonth;
					}).first();
					
					if (selectedOption.length > 0) {
						const a = selectedOption.find('a');
						$('#futures_month').val(recordFuturesMonth);
						$('#futuresMonthSelector').html(a.html());
						
						// Set futures price if available
						if (record.futures_price) {
							$('#futures_price').val(record.futures_price.toFixed(4));
						}
						
						// Set "as of" date
						if (record.sale_date) {
							$('#futures_price_as_of').html('As of ' + moment(record.sale_date).subtract(1, "day").format("MMM DD, YYYY"));
						}
						
						// Trigger cash price calculation
						$('#futures_price').trigger('input');
					} else {
						console.error('Failed to find the option after insertion');
					}
				}
			}
			
			// Populate nearby futures month for HTA
			if (record.sale_type === 'HTA' && record.nearby_futures_month) {
				let recordNearbyFuturesMonth = record.nearby_futures_month;
				if (recordNearbyFuturesMonth && recordNearbyFuturesMonth.length > 7) {
					recordNearbyFuturesMonth = recordNearbyFuturesMonth.slice(0, 7);
				}
				
				let foundNearby = false;
				// Find and select the matching option
				const nearbyFuturesMonthOptions = $('#nearby_futures_month_options li');
				nearbyFuturesMonthOptions.each(function() {
				const monthValue = getFuturesMonthValue($(this));
					if (monthValue === recordNearbyFuturesMonth) {
						foundNearby = true;
						// Set the hidden input value
						$('#nearby_futures_month').val(monthValue);
						
						// Update the button display
						const a = $(this).find('a');
						$('#nearbyFuturesMonthSelector').html(a.html());
						
						// Set the nearby futures price
					const nearbyFuturesPrice = getFuturesPriceValue($(this));
						if (nearbyFuturesPrice) {
							$('#nearby_futures_price').val(nearbyFuturesPrice);
							$('#nearby_futures_price_txt').html('Captured Fut. Price: ' + nearbyFuturesPrice);
						}
						
						return false; // Break the loop
					}
				});
				
				// If not found, create and add the option in sorted position
				if (!foundNearby) {
					const newNearbyOption = createFuturesMonthOptionForEdit(
						record.nearby_futures_month,
						record.nearby_futures_price || null,
						record.sale_date || moment().format('YYYY-MM-DD')
					);
					insertFuturesMonthOptionInOrder($('#nearby_futures_month_options'), newNearbyOption);
					
					// Now select it
					const a = newNearbyOption.find('a');
					$('#nearby_futures_month').val(recordNearbyFuturesMonth);
					$('#nearbyFuturesMonthSelector').html(a.html());
					
					// Set nearby futures price if available
					if (record.nearby_futures_price) {
						$('#nearby_futures_price').val(record.nearby_futures_price);
						$('#nearby_futures_price_txt').html('Captured Fut. Price: ' + record.nearby_futures_price);
					}
				}
			}
			
			// Trigger input on delivery_month to sync with picker
			if (record.delivery_month) {
				$('#delivery_month').trigger('input');
			}
		}, 300); // Delay to ensure options are populated and DOM is updated
	});
}

const deleteSaleLedger = async function(id){
	const record = await getSalesRecord(id);
	if (!record) {
		console.error('Record not found:', id);
		return;
	}
	
	// Check if this record has child records
	const hasChildren = sales_data.some(sale => sale.parent_id === id);
	
	// Set up the confirmation message
	let confirmMessage = 'Are you sure you want to delete this sales record?';
	if (hasChildren) {
		confirmMessage = 'This record has child records. Deleting it will also delete all child records. Are you sure you want to proceed?';
	}
	
	$('#deleteConfirmMessage').text(confirmMessage);
	
	// Store the ID to delete in a data attribute
	$('#deleteConfirmModal').data('deleteId', id);
	$('#deleteConfirmModal').data('hasChildren', hasChildren);
	
	// Show the modal
	const deleteModal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
	deleteModal.show();
}

function renderSalesTable() {
	const tbody = $('#sales_data');
	tbody.empty();
	// Get all top-level records (parent_id === null)
	const topLevelSales = sales_data.filter(sale => sale.parent_id === null);	
		if (topLevelSales.length === 0) {
		const emptyRow = $('<tr>').addClass('sale-empty-row');
		emptyRow.append(
			$('<td>')
				.attr('colspan', 10)
				.addClass('_cell')
				.text('No sales records for Customer ABC / CORN 2025')
		);
		tbody.append(emptyRow);
		return;
	}
	topLevelSales.forEach((sale) => {
		// Create a deep copy of the top-level record to avoid modifying sales_data
		const topLevelCopy = JSON.parse(JSON.stringify(sale));
		
		// Find all child records (where parent_id === sale.id) and create copies
		const childRecords = sales_data
			.filter(child => child.parent_id === sale.id)
			.map(child => JSON.parse(JSON.stringify(child)));
		
		// Combine top-level copy with child records
		const allChildRecords = [topLevelCopy, ...childRecords];
		
		// Sort all child records by sale_date (oldest first) - this only modifies our local array
		allChildRecords.sort((a, b) => {
			const dateA = moment(a.sale_date);
			const dateB = moment(b.sale_date);
			return dateA - dateB; // Oldest first
		});
		
		// Determine origin and latest records for display
		const originRecord = allChildRecords[0];
		const latestRecord = allChildRecords[allChildRecords.length - 1];
		// Last Updated: use only updated_at (set on create/update); most recent among children
		const lastUpdatedRecord = allChildRecords.reduce((a, b) => {
			const aTime = (a.updated_at && moment(a.updated_at).valueOf()) || 0;
			const bTime = (b.updated_at && moment(b.updated_at).valueOf()) || 0;
			return aTime > bTime ? a : b;
		});
		const lastUpdatedAt = lastUpdatedRecord.updated_at || null;
		const totalSetQuantity = allChildRecords
			.filter(record => record.status === 'Set' || record.status === 'Updated')
			.reduce((sum, record) => sum + (parseInt(record.quantity || 0, 10) || 0), 0);
		const totalRolledQuantity = allChildRecords
			.filter(record => record.status === 'Rolled')
			.reduce((sum, record) => sum + (parseInt(record.quantity || 0, 10) || 0), 0);
		const remainingQuantity = getRemainingQuantity(originRecord);
		const hasSetRecords = (originRecord.sale_type === 'Cash') || totalSetQuantity > 0;
		const merchValue = hasSetRecords ? allChildRecords.reduce((sum, record) => {
			const merchGain = parseFloat(record.merch_gain);
			const carry = parseFloat(record.carry);
			const serviceFee = parseFloat(record.service_fee);
			let net = (Number.isNaN(merchGain) ? 0 : merchGain) + (Number.isNaN(carry) ? 0 : carry) - (Number.isNaN(serviceFee) ? 0 : serviceFee);
			// Add (Set Basis - Initial Basis) for Set records when origin has Initial Basis Price
			const isSet = record.status === 'Set' || record.status === 'Updated';
			const originRec = getOriginRecord(record);
			if (isSet && originRec && (originRec.initial_basis_price != null && originRec.initial_basis_price !== '')) {
				const setBasis = parseFloat(record.basis_price);
				const initBasis = parseFloat(originRec.initial_basis_price);
				if (!Number.isNaN(setBasis) && !Number.isNaN(initBasis)) {
					net += (setBasis - initBasis);
				}
			}
			return sum + net;
		}, 0) : null;
		
		// Compute parent status per requirements
		const originQty = parseInt(originRecord.quantity || 0, 10) || 0;
		const pendingQty = Math.max(0, originQty - totalSetQuantity); // not yet Set (includes Rolled)
		let parentStatusCell = $('<div>').addClass('_cell');
		if (originRecord.sale_type === 'Cash') {
			parentStatusCell.text('Set');
		} else if (totalSetQuantity >= originQty) {
			parentStatusCell.text('Set');
		} else if (totalSetQuantity > 0) {
			parentStatusCell.append($('<div>').text(`Set: ${formatQuantity(totalSetQuantity)}`));
			parentStatusCell.append($('<div>').text(`Pending: ${formatQuantity(pendingQty)}`));
		} else {
			parentStatusCell.append($('<div>').text(`Pending: ${formatQuantity(pendingQty)}`));
			if (totalRolledQuantity > 0) {
				parentStatusCell.append($('<div>').text(`Rolled: ${formatQuantity(totalRolledQuantity)}`));
			}
		}
		
		// Create display record for top-level (use latest data but keep original ID)
		const displayRecord = Object.assign({}, latestRecord, { id: sale.id });
		
		// Main sale row - use displayRecord data
		const mainRow = $('<tr>')
			.attr('onclick', `expandSaleLedger(${sale.id})`)
			.attr('data-sale-id', sale.id);
		
		// First cell: expand/collapse caret
		const caretDiv = $('<div>').addClass('_cell').addClass('_cell-caret');
		caretDiv.append($('<span>').addClass('_row-caret').attr('aria-hidden', 'true'));
		mainRow.append($('<td>').html(caretDiv));
		
		// Parent columns
		mainRow.append($('<td>').html($('<div>').addClass('_cell').text(formatDate(originRecord.sale_date))));
		mainRow.append($('<td>').attr('data-last-updated', lastUpdatedAt || '').html($('<div>').addClass('_cell').text(lastUpdatedAt ? formatRelativeDate(lastUpdatedAt) : '--')));
		mainRow.append($('<td>').html($('<div>').addClass('_cell').text(originRecord.sale_type)));
		mainRow.append($('<td>').html(parentStatusCell));
		mainRow.append($('<td>').html($('<div>').addClass('_cell').text(formatQuantity(originRecord.quantity))));
		const merchValueCellInner = $('<div>').addClass('_cell').css('display', 'inline-flex').css('align-items', 'center').css('gap', '4px');
		const hasMerchValue = merchValue != null && merchValue !== '' && merchValue !== 0;
		if (hasMerchValue) {
			const merchValueTipIcon = $('<span>').addClass('merch-value-tip sale_tip').attr('data-bs-toggle', 'popover').attr('data-bs-html', 'true').attr('data-bs-title', 'Merch Value Calculation').attr('data-sale-id', sale.id).html('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="8"></line><line x1="12" y1="11" x2="12" y2="16"></line></svg>');
			merchValueTipIcon.on('click', function(e) { e.stopPropagation(); });
			merchValueCellInner.append(merchValueTipIcon);
		}
		const valueSpan = $('<span>').addClass('merch-value-text');
		if (hasMerchValue) {
			const priceSpan = $('<span>').text(formatPrice(merchValue)).css('color', merchValue < 0 ? '#ff7474' : '#77ff76');
			valueSpan.append(priceSpan).append(document.createTextNode(' / bu.'));
		} else {
			valueSpan.text('--');
		}
		merchValueCellInner.append(valueSpan);
		const merchValueCell = $('<td>').html(merchValueCellInner);
		mainRow.append(merchValueCell);
		// Avg Cash Price: Cash uses Cash Price; HTA/Basis uses average Cash Price of all Set records
		let avgCashPrice;
		if (originRecord.sale_type === 'Cash') {
			avgCashPrice = originRecord.cash_price != null && originRecord.cash_price !== '' ? parseFloat(originRecord.cash_price) : null;
		} else if (originRecord.sale_type === 'HTA' || originRecord.sale_type === 'Basis') {
			const setRecords = allChildRecords.filter(r => r.status === 'Set' || r.status === 'Updated');
			if (setRecords.length === 0) {
				avgCashPrice = null;
			} else {
				const sum = setRecords.reduce((s, r) => s + (parseFloat(r.cash_price) || 0), 0);
				avgCashPrice = sum / setRecords.length;
			}
		} else {
			avgCashPrice = null;
		}
		const hasAvgCashPrice = avgCashPrice != null && !Number.isNaN(avgCashPrice);
		const avgCashPriceCellInner = $('<div>').addClass('_cell').css('display', 'inline-flex').css('align-items', 'center').css('gap', '4px');
		if (hasAvgCashPrice) {
			const avgCashPriceTipIcon = $('<span>').addClass('avg-cash-price-tip sale_tip').attr('data-bs-toggle', 'popover').attr('data-bs-html', 'true').attr('data-bs-title', 'Avg. Cash Price Calculation').attr('data-sale-id', sale.id).html('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="8"></line><line x1="12" y1="11" x2="12" y2="16"></line></svg>');
			avgCashPriceTipIcon.on('click', function(e) { e.stopPropagation(); });
			avgCashPriceCellInner.append(avgCashPriceTipIcon);
		}
		const avgCashPriceText = hasAvgCashPrice ? formatPrice(avgCashPrice) + ' / bu.' : '--';
		avgCashPriceCellInner.append($('<span>').addClass('avg-cash-price-text').text(avgCashPriceText));
		mainRow.append($('<td>').html(avgCashPriceCellInner));
		// Final Sale Value: Cash = Quantity * Cash Price; HTA/Basis = sum of (Quantity * Cash Price) for all Set records
		let finalSaleValue;
		if (originRecord.sale_type === 'Cash') {
			const cashQty = parseInt(originRecord.quantity || 0, 10) || 0;
			const cashPrice = parseFloat(originRecord.cash_price) || 0;
			finalSaleValue = (originRecord.cash_price != null && originRecord.cash_price !== '') ? cashQty * cashPrice : null;
		} else if (originRecord.sale_type === 'HTA' || originRecord.sale_type === 'Basis') {
			const setRecords = allChildRecords.filter(r => r.status === 'Set' || r.status === 'Updated');
			finalSaleValue = setRecords.reduce((sum, r) => {
				const qty = parseInt(r.quantity || 0, 10) || 0;
				const cp = parseFloat(r.cash_price) || 0;
				return sum + (qty * cp);
			}, 0);
			if (setRecords.length === 0) finalSaleValue = null;
		} else {
			finalSaleValue = null;
		}
		const hasFinalSaleValue = finalSaleValue != null && !Number.isNaN(finalSaleValue);
		const finalSaleValueCellInner = $('<div>').addClass('_cell').css('display', 'inline-flex').css('align-items', 'center').css('gap', '4px');
		if (hasFinalSaleValue) {
			const finalSaleValueTipIcon = $('<span>').addClass('final-sale-value-tip sale_tip').attr('data-bs-toggle', 'popover').attr('data-bs-html', 'true').attr('data-bs-title', 'Final Sale Value Calculation').attr('data-sale-id', sale.id).html('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="8"></line><line x1="12" y1="11" x2="12" y2="16"></line></svg>');
			finalSaleValueTipIcon.on('click', function(e) { e.stopPropagation(); });
			finalSaleValueCellInner.append(finalSaleValueTipIcon);
		}
		const finalSaleValueText = hasFinalSaleValue ? '$' + finalSaleValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
		finalSaleValueCellInner.append($('<span>').addClass('final-sale-value-text').text(finalSaleValueText));
		mainRow.append($('<td>').html(finalSaleValueCellInner));
		const contractLocation = originRecord.sale_type === 'HTA' ? (originRecord.hta_contract_holder || '--') : originRecord.sale_type === 'Basis' ? (originRecord.basis_contract_holder || '--') : (originRecord.delivery_location || '--');
		mainRow.append($('<td>').html($('<div>').addClass('_cell').text(contractLocation)));
		
		tbody.append(mainRow);
		
		// Render expanded tracking table row
		const ledgerRow = $('<tr>')
			.addClass('sale_ledger')
			.addClass(`sale_ledger-${sale.id}`);
		const ledgerCell = $('<td>')
			.attr('colspan', 10)
			.addClass('sale-ledger-cell');
		const ledgerTable = $('<table>').addClass('_table-inner');
		const ledgerScroll = $('<div>').addClass('sale-ledger-scroll');
		const ledgerHead = $('<thead>').append(
			$('<tr>')
				.append($('<th>').addClass('ledger-date-head').text('Sale Date'))
				.append($('<th>').addClass('ledger-action-head').text('Action'))
				.append($('<th>').text('Quantity (bu.)'))
				.append($('<th>').text('Futures Month'))
				.append($('<th>').text('Pending (bu.)'))
				.append($('<th>').text('Delivery Month'))
				.append($('<th>').text('Futures Price'))
				.append($('<th>').text('Merch Gain'))
				.append($('<th>').text('Carry'))
				.append($('<th>').text('Basis Price'))
				.append($('<th>').text('Service Fee'))
				.append($('<th>').text('Cash Price'))
				.append($('<th>').text('Contract Holder'))
				.append($('<th>').text('Delivery Location'))
				.append($('<th>').text('Comments'))
		);
		const ledgerBody = $('<tbody>');

		allChildRecords.forEach((ledger, ledgerIndex) => {
			const isTopLevelCopy = ledger === topLevelCopy;
			const origin = getOriginRecord(ledger);
			const canTrack = origin && (origin.sale_type === 'HTA' || origin.sale_type === 'Basis');
			const hasSet = remainingQuantity <= 0;
			const isLatest = ledgerIndex === allChildRecords.length - 1;
			const ledgerQty = parseInt(ledger.quantity || 0, 10) || 0;
			// Remaining from this record = its qty minus Set/Rolled records that consumed from this one
			const remainingFromThisRecord = getRemainingFromRecord(ledger);
			// Show Set/Roll on origin when it has remaining qty, or on any non-Set record that still has remaining qty (not yet consumed by later Set/Roll)
			const canAddTracking = canTrack && (
				(isTopLevelCopy && remainingQuantity > 0) ||
				(!isTopLevelCopy && ledger.status !== 'Set' && remainingFromThisRecord > 0)
			);
			const hasOriginAction = allChildRecords.some(record => record.status === 'Set' || record.status === 'Rolled');
			const canEditOrigin = !hasOriginAction;

			// First tracking record always shows "Created" (or "Set" for Cash); others use stored status
			const actionText = origin && origin.sale_type === 'Cash'
				? (isTopLevelCopy ? 'Set' : (ledger.status === 'Set' || ledger.status === 'Updated' ? 'Set' : ledger.status === 'Rolled' ? 'Rolled' : 'Pending'))
				: isTopLevelCopy
					? 'Created'
					: ledger.status === 'Created'
						? 'Created'
						: ledger.status === 'Set' || ledger.status === 'Updated'
							? 'Set'
							: ledger.status === 'Rolled'
								? 'Rolled'
								: 'Pending';
			const hasMerchGainValue = ledger.merch_gain !== null && ledger.merch_gain !== undefined;
			const futuresMonthCell = $('<div>');
			if (origin && origin.sale_type === 'HTA' && isTopLevelCopy) {
				futuresMonthCell.append($('<div>').append(document.createTextNode('Futures Month: ')).append($('<span>').css('fontWeight', 'bold').text(formatMonth(ledger.futures_month))));
				futuresMonthCell.append($('<div>').append(document.createTextNode('Comp. Fut. Month: ')).append($('<span>').css('fontWeight', 'bold').text(formatMonth(ledger.nearby_futures_month))));
			} else if (ledger.status === 'Rolled' && getSourceId(ledger)) {
				const sourceRecord = allChildRecords.find(r => String(r.id) === String(getSourceId(ledger)));
				const origMonth = sourceRecord && sourceRecord.futures_month ? formatMonth(sourceRecord.futures_month) : '?';
				futuresMonthCell.append(document.createTextNode(origMonth + ' \u00BB '));
				futuresMonthCell.append($('<span>').css('fontWeight', 'bold').text(formatMonth(ledger.futures_month)));
			} else {
				futuresMonthCell.append($('<span>').css('fontWeight', 'bold').text(formatMonth(ledger.futures_month)));
			}
			const futuresPriceCell = $('<div>');
			if (origin && origin.sale_type === 'HTA' && isTopLevelCopy) {
				futuresPriceCell.append($('<div>').append(document.createTextNode('Futures Price: ')).append($('<span>').css('fontWeight', 'bold').text(formatPrice(ledger.futures_price))));
				futuresPriceCell.append($('<div>').append(document.createTextNode('Captured Nearby Fut. Price: ')).append($('<span>').css('fontWeight', 'bold').text(formatPrice(ledger.nearby_futures_price))));
			} else {
				futuresPriceCell.append($('<span>').css('fontWeight', 'bold').text(formatPrice(ledger.futures_price)));
			}
			const carryText = ledger.status === 'Rolled' && (ledger.carry !== null && ledger.carry !== undefined && ledger.carry !== '')
				? formatPrice(ledger.carry)
				: '--';
			const hasCarryValue = carryText !== '--';
			const getValueStyle = (num) => ({ fontWeight: 'bold', color: (num < 0 ? '#ff7474' : '#77ff76') });
			const carryStyle = hasCarryValue ? getValueStyle(parseFloat(ledger.carry) || 0) : {};
			const isHtaOriginBasis = origin && origin.sale_type === 'HTA' && isTopLevelCopy;
			const basisValue = isHtaOriginBasis ? ledger.initial_basis_price : ledger.basis_price;
			const basisFormatted = formatPrice(basisValue);
			const basisNum = (basisValue != null && basisValue !== '') ? parseFloat(basisValue) : NaN;
			const hasBasisValue = !Number.isNaN(basisNum);
			const basisDisplayText = hasBasisValue
				? (basisNum < 0 ? `(${formatPrice(Math.abs(basisValue))})` : basisFormatted)
				: basisFormatted;
			const basisValueStyle = {}; // No color on Basis Price; color only for Merch Value calculation fields
			// Set records: show Net Initial Basis = Set Basis - Initial Basis when origin has Initial Basis Price
			const isSetRecord = ledger.status === 'Set' || ledger.status === 'Updated';
			const hasInitialBasis = origin && (origin.initial_basis_price != null && origin.initial_basis_price !== '');
			const setBasis = ledger.basis_price != null && ledger.basis_price !== '' ? parseFloat(ledger.basis_price) : NaN;
			const initialBasis = hasInitialBasis ? parseFloat(origin.initial_basis_price) : NaN;
			const netInitialBasis = isSetRecord && !Number.isNaN(setBasis) && !Number.isNaN(initialBasis)
				? setBasis - initialBasis
				: null;
			const contractHolderText = origin && origin.sale_type === 'HTA'
				? (ledger.hta_contract_holder || '--')
				: (ledger.basis_contract_holder || '--');
			const deliveryLocationText = ledger.delivery_location || '--';

			const ledgerRowInner = $('<tr>');
			if (canAddTracking) {
				ledgerRowInner.addClass('ledger-row-has-set-roll');
			}
			const dateCell = $('<td>').addClass('ledger-date-cell');
			const dateTextElem = $('<div>').addClass('ledger-date-text').text(formatDate(ledger.sale_date));
			const actionCell = $('<td>').addClass('ledger-action-cell');
			const actionTextElem = $('<div>').addClass('ledger-action-text').text(actionText);
			const actionToolbar = $('<div>').addClass('_row-toolbar ledger-action-toolbar');
			const actionLabel = $('<div>').addClass('ledger-action-label');
			actionToolbar.append(actionLabel);
			const actionSticky = $('<div>').addClass('ledger-action-sticky');
			if (!isTopLevelCopy || canEditOrigin) {
				actionToolbar.append(
					$('<button>')
						.addClass('_toolbar-btn _edit-btn')
						.on('mouseenter', function() { actionLabel.text('Edit'); })
						.attr('data-action-label', 'Edit')
						.attr('onclick', `event.stopPropagation(); editSaleLedger(${ledger.id})`)
						.attr('title', 'Edit')
				);
			}
			actionToolbar.append(
				$('<button>')
					.addClass('_toolbar-btn _delete-btn')
					.on('mouseenter', function() { actionLabel.text('Delete'); })
					.attr('data-action-label', 'Delete')
					.attr('onclick', `event.stopPropagation(); deleteSaleLedger(${ledger.id})`)
					.attr('title', 'Delete')
			);
			actionSticky.append(actionToolbar);
			dateCell.append(actionSticky).append(dateTextElem);
			actionCell.append(actionTextElem);

			// Max quantity pending for Set/Roll (only for rows with Set and Roll options)
			const pendingBu = canAddTracking ? (isTopLevelCopy ? remainingQuantity : remainingFromThisRecord) : null;
			const pendingBuText = pendingBu != null && pendingBu > 0 ? formatQuantity(pendingBu) : '--';
			const pendingCell = $('<td>').addClass('ledger-pending-cell');
			pendingCell.append($('<div>').addClass('ledger-pending-value').text(pendingBuText));
			if (pendingBu != null && pendingBu > 0) {
				const pendingBtns = $('<div>').addClass('ledger-pending-btns');
				pendingBtns.append(
					$('<button>')
						.addClass('ledger-pending-btn _set-btn')
						.text('Set')
						.attr('onclick', `event.stopPropagation(); openSetSelection(getSalesRecordSync(${ledger.id}))`)
						.attr('title', 'Set')
				);
				pendingBtns.append(
					$('<button>')
						.addClass('ledger-pending-btn _roll-btn')
						.text('Roll')
						.attr('onclick', `event.stopPropagation(); openRollSelection(getSalesRecordSync(${ledger.id}))`)
						.attr('title', 'Roll')
				);
				pendingCell.append(pendingBtns);
			}

			actionToolbar.on('mouseleave', function() { actionLabel.text(''); });
			ledgerRowInner.on('mouseleave', function() { actionLabel.text(''); });
			ledgerRowInner
				.append(dateCell)
				.append(actionCell)
				.append($('<td>').text(formatQuantity(ledger.quantity)))
				.append($('<td>').append(futuresMonthCell))
				.append(pendingCell)
				.append($('<td>').text(formatMonth(ledger.delivery_month)))
				.append($('<td>').append(futuresPriceCell))
				.append((() => {
					const mgCell = $('<td>');
					if (hasMerchGainValue) {
						const mgNum = parseFloat(ledger.merch_gain) || 0;
						mgCell.append($('<span>').text(formatPrice(ledger.merch_gain)).css({ fontWeight: 'bold', color: mgNum < 0 ? '#ff7474' : '#77ff76' }));
					} else {
						mgCell.text('--');
					}
					return mgCell;
				})())
				.append($('<td>').text(carryText).css(carryStyle))
				.append((() => {
					const basisCell = $('<td>');
					basisCell.append($('<div>').text(basisDisplayText).css(basisValueStyle));
					if (isHtaOriginBasis) {
						basisCell.append($('<div>').addClass('ledger-initial-basis-label').text('Initial Basis Price'));
					}
					if (netInitialBasis !== null) {
						const netLine = $('<div>').addClass('ledger-initial-basis-label');
						netLine.append(document.createTextNode('Net Initial Basis: '));
						const netStyle = netInitialBasis === 0 ? { fontWeight: 'bold' } : getValueStyle(netInitialBasis);
						netLine.append($('<span>').text(formatPrice(netInitialBasis)).css(netStyle));
						basisCell.append(netLine);
					}
					return basisCell;
				})())
				.append((() => {
					const feeVal = ledger.service_fee != null && ledger.service_fee !== '' ? parseFloat(ledger.service_fee) : null;
					const feeFormatted = formatPrice(ledger.service_fee);
					const feeDisplay = feeVal != null ? `(${formatPrice(feeVal < 0 ? Math.abs(ledger.service_fee) : ledger.service_fee)})` : feeFormatted;
					const serviceFeeCell = $('<td>').text(feeDisplay);
					if (ledger.service_fee != null && ledger.service_fee !== '') {
						serviceFeeCell.css('color', '#ff7474');
					}
					return serviceFeeCell;
				})())
				.append($('<td>').text(formatPrice(ledger.cash_price)))
				.append($('<td>').text(contractHolderText))
				.append($('<td>').text(deliveryLocationText))
				.append($('<td>').append($('<div>').addClass('ledger-comments-cell').text(ledger.comments || '--')));

			ledgerBody.append(ledgerRowInner);
		});

		ledgerTable.append(ledgerHead).append(ledgerBody);
		ledgerScroll.append(ledgerTable);
		ledgerScroll.on('scroll', function() {
			syncLedgerToolbarPosition($(this));
		});
		syncLedgerToolbarPosition(ledgerScroll);
		ledgerCell.append(ledgerScroll);
		ledgerRow.append(ledgerCell);
		tbody.append(ledgerRow);
	});
	
	// Initialize Merch Value tip popovers with dynamic breakdown content
	$('#sales_data > tr > td .merch-value-tip').each(function() {
		const el = this;
		const saleId = parseInt($(el).attr('data-sale-id'), 10);
		const content = buildMerchValueBreakdownHtml(saleId);
		new bootstrap.Popover(el, { trigger: 'click', html: true, sanitize: false, title: 'Merch Value Calculation', content: content || '<em>No data</em>', container: 'body', customClass: 'merch-value-popover' });
		$(el).on('shown.bs.popover', function() {
			$('#sales_data .merch-value-tip').each(function() { if (this !== el) { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); } });
			$('#sales_data .avg-cash-price-tip, #sales_data .final-sale-value-tip').each(function() { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); });
		});
	});
	// Initialize Avg Cash Price tip popovers
	$('#sales_data > tr > td .avg-cash-price-tip').each(function() {
		const el = this;
		const saleId = parseInt($(el).attr('data-sale-id'), 10);
		const content = buildAvgCashPriceBreakdownHtml(saleId);
		new bootstrap.Popover(el, { trigger: 'click', html: true, sanitize: false, title: 'Avg. Cash Price Calculation', content: content || '<em>No data</em>', container: 'body', customClass: 'avg-cash-price-popover' });
		$(el).on('shown.bs.popover', function() {
			$('#sales_data .merch-value-tip').each(function() { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); });
			$('#sales_data .avg-cash-price-tip').each(function() { if (this !== el) { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); } });
			$('#sales_data .final-sale-value-tip').each(function() { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); });
		});
	});
	// Initialize Final Sale Value tip popovers
	$('#sales_data > tr > td .final-sale-value-tip').each(function() {
		const el = this;
		const saleId = parseInt($(el).attr('data-sale-id'), 10);
		const content = buildFinalSaleValueBreakdownHtml(saleId);
		new bootstrap.Popover(el, { trigger: 'click', html: true, sanitize: false, title: 'Final Sale Value Calculation', content: content || '<em>No data</em>', container: 'body', customClass: 'final-sale-value-popover' });
		$(el).on('shown.bs.popover', function() {
			$('#sales_data .merch-value-tip').each(function() { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); });
			$('#sales_data .avg-cash-price-tip').each(function() { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); });
			$('#sales_data .final-sale-value-tip').each(function() { if (this !== el) { const p = bootstrap.Popover.getInstance(this); if (p) p.hide(); } });
		});
	});
	// Capture phase: when a table tooltip popover is open and user clicks outside, close it and stop propagation
	// so the click doesn't trigger row toggle (expandSaleLedger)
	document.removeEventListener('click', tableTipCloseCaptureHandler, true);
	document.addEventListener('click', tableTipCloseCaptureHandler, true);
	
	// Restore expanded state after rerender
	if (expandedSaleId) {
		const parentRow = $(`tr[data-sale-id="${expandedSaleId}"]`);
		if (parentRow.length) {
			expandSaleLedger(expandedSaleId);
			// When newly added: scroll to the record (e.g. if at bottom)
			if (newlyAddedSaleId === expandedSaleId) {
				parentRow[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				newlyAddedSaleId = null;
			}
		} else {
			expandedSaleId = null;
			newlyAddedSaleId = null;
		}
	} else {
		newlyAddedSaleId = null;
	}
}