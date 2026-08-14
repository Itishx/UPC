import { supabase, CURRENT_VOLUME } from './supabase.js';

const form = document.getElementById('registerForm');
if (form) {
  const note = document.getElementById('formNote');
  const totalEl = document.getElementById('registerTotal');
  const submitBtn = document.getElementById('registerSubmit');

  const PRICES = { performer: 299, listener: 199 };

  // Live total as the tier changes
  form.querySelectorAll('input[name="tier"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      totalEl.innerHTML = `Total <strong>&#8377;${PRICES[radio.value]}</strong>`;
    });
  });

  // Phone: digits only, max 10
  const phoneInput = document.getElementById('phone');
  phoneInput.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 10);
  });

  // Instagram: strip a leading @ if they type one (the field already shows it)
  const instaInput = document.getElementById('instagram');
  instaInput.addEventListener('input', () => {
    instaInput.value = instaInput.value.replace(/^@+/, '').trim();
  });

  function fail(message, field) {
    note.textContent = message;
    note.className = 'form-note error';
    if (field) {
      field.classList.add('invalid');
      field.focus();
    }
    return false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    note.textContent = '';
    note.className = 'form-note';

    const tier = form.querySelector('input[name="tier"]:checked');
    const fullName = document.getElementById('fullName').value.trim();
    const age = parseInt(document.getElementById('age').value, 10);
    const phone = phoneInput.value.trim();
    const instagram = instaInput.value.replace(/^@+/, '').trim();

    if (!tier) return fail('Pick how you\'re joining — performer or listener.');
    if (fullName.length < 2) return fail('Please enter your full name.', document.getElementById('fullName'));
    if (!Number.isInteger(age) || age < 10 || age > 100) {
      return fail('Please enter a valid age.', document.getElementById('age'));
    }
    if (!/^[0-9]{10}$/.test(phone)) return fail('Phone number must be exactly 10 digits.', phoneInput);
    if (!instagram) return fail('Please enter your Instagram handle.', instaInput);

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Booking…';

    try {
      // Look up the open session for the current volume.
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('id, volume_number, title')
        .eq('volume_number', CURRENT_VOLUME)
        .single();

      if (sessionError || !session) {
        throw new Error('Could not find the current session. Has schema.sql been run?');
      }

      // amount + volume_number are set server-side by the trigger; sending them
      // here just keeps the row readable if the trigger is ever dropped.
      const { error } = await supabase.from('registrations').insert({
        session_id: session.id,
        volume_number: session.volume_number,
        full_name: fullName,
        age,
        phone,
        instagram,
        tier: tier.value,
        amount: PRICES[tier.value],
      });

      if (error) {
        if (error.code === '23505') {
          return fail('That phone number is already booked for this session.', phoneInput);
        }
        throw error;
      }

      form.innerHTML = `
        <div class="register-success">
          <p class="register-success-title">You're in, ${escapeHtml(fullName.split(' ')[0])}.</p>
          <p>Seat saved for <strong>Volume ${session.volume_number}</strong> on the 22nd as a
             <strong>${tier.value}</strong>. We'll message you on
             <strong>${escapeHtml(phone)}</strong> with the venue and timings.</p>
          <p class="register-success-amount">Amount due at the door &mdash; &#8377;${PRICES[tier.value]}</p>
        </div>`;
    } catch (err) {
      console.error(err);
      note.textContent = 'Something went wrong saving your booking. Please try again.';
      note.className = 'form-note error';
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
