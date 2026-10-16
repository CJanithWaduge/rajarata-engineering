import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { configureContactAppCheck, getFirebaseApp } from './firebaseClient';

interface InquiryPayload {
  fullName: string;
  company: string;
  email: string;
  phone: string;
  service: string;
  location: string;
  urgency: string;
  message: string;
  consent: boolean;
  website: string;
}

interface InquiryResponse {
  accepted: boolean;
}

const form = document.getElementById('contact-quotation-form') as HTMLFormElement | null;
const feedback = document.getElementById('form-feedback');
const submitButton = form?.querySelector<HTMLButtonElement>('[data-submit-button]');

function feedbackMessage(message: string, tone: 'success' | 'error'): void {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove('hidden', 'bg-error-container', 'text-on-error-container', 'bg-tertiary-fixed', 'text-on-tertiary-fixed');
  feedback.classList.add(
    ...(tone === 'success'
      ? ['bg-tertiary-fixed', 'text-on-tertiary-fixed']
      : ['bg-error-container', 'text-on-error-container']),
  );
  feedback.setAttribute('role', tone === 'success' ? 'status' : 'alert');
}

function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'Your inquiry could not be sent. Please try again later.';
  }
  switch (error.code) {
    case 'functions/resource-exhausted':
      return 'Too many inquiries were sent. Please wait before trying again.';
    case 'functions/invalid-argument':
      return 'Please check the required fields and consent, then try again.';
    case 'functions/failed-precondition':
      return 'The inquiry service is not ready. Please try again later.';
    default:
      return 'Your inquiry could not be sent. Please try again later.';
  }
}

function createCallable() {
  const app = getFirebaseApp();
  const functions = getFunctions(app, 'asia-south1');
  const emulatorHost = import.meta.env.DEV
    ? import.meta.env.PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_HOST
    : undefined;
  if (emulatorHost) {
    const [host, portText] = emulatorHost.split(':');
    const port = Number(portText);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('The Functions emulator address is invalid.');
    }
    connectFunctionsEmulator(functions, host, port);
  } else {
    configureContactAppCheck();
  }
  return httpsCallable<InquiryPayload, InquiryResponse>(
    functions,
    'submitContactInquiry',
    { timeout: 20_000 },
  );
}

function formPayload(source: HTMLFormElement): InquiryPayload {
  const values = new FormData(source);
  const value = (name: string): string => {
    const item = values.get(name);
    return typeof item === 'string' ? item : '';
  };
  return {
    fullName: value('fullName'),
    company: value('company'),
    email: value('email'),
    phone: value('phone'),
    service: value('service'),
    location: value('location'),
    urgency: value('urgency'),
    message: value('message'),
    consent: values.get('consent') === 'on',
    website: value('website'),
  };
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !feedback || !submitButton) return;
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  const label = submitButton.querySelector('span:last-child');
  const originalLabel = label?.textContent ?? 'SEND INQUIRY';
  if (label) label.textContent = 'SENDING…';
  feedback.classList.add('hidden');

  try {
    const response = await createCallable()(formPayload(form));
    if (response.data.accepted !== true) {
      throw new Error('The inquiry service returned an invalid response.');
    }
    form.reset();
    feedbackMessage('Your inquiry has been sent. Thank you for contacting us.', 'success');
  } catch (error) {
    feedbackMessage(errorMessage(error), 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
    if (label) label.textContent = originalLabel;
  }
});
