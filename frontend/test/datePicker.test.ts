import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '../src/locales/en';
import DatePicker from '../src/components/ui/DatePicker.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });

function setup(modelValue: string | null, props: Record<string, unknown> = {}) {
  return mount(DatePicker, {
    props: { modelValue, 'onUpdate:modelValue': (v: string | null) => w.setProps({ modelValue: v }), ...props },
    global: { plugins: [i18n()] },
    attachTo: document.body,
  });
}
let w: ReturnType<typeof setup>;

describe('DatePicker', () => {
  it('shows the selected date and opens on the selected month', async () => {
    w = setup('2024-02-14');
    expect(w.text()).toContain('Feb 14, 2024');
    await w.find('[data-trigger]').trigger('click');
    expect(w.find('[role="dialog"]').exists()).toBe(true);
    expect((w.find('select[aria-label="Month"]').element as HTMLSelectElement).value).toBe('1');
    expect(w.find('[aria-selected="true"]').text()).toBe('14');
    w.unmount();
  });

  it('selects a day and closes', async () => {
    w = setup('2024-02-14');
    await w.find('[data-trigger]').trigger('click');
    const day20 = w.findAll('tbody button').find((b) => b.attributes('aria-label')?.includes('February 20, 2024'))!;
    await day20.trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['2024-02-20']);
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    w.unmount();
  });

  it('supports keyboard navigation', async () => {
    w = setup('2024-02-14');
    await w.find('[data-trigger]').trigger('click');
    const dialog = w.find('[role="dialog"]');
    await dialog.trigger('keydown', { key: 'ArrowRight' });
    await dialog.trigger('keydown', { key: 'ArrowDown' });
    await dialog.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['2024-02-22']);
    w.unmount();
  });

  it('disables dates after max and can be cleared', async () => {
    w = setup('2024-02-14', { max: '2024-02-15' });
    await w.find('[data-trigger]').trigger('click');
    const day16 = w.findAll('tbody button').find((b) => b.attributes('aria-label')?.includes('February 16, 2024'))!;
    expect(day16.attributes('disabled')).toBeDefined();
    await w.find('button[aria-label="Clear"]').trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([null]);
    w.unmount();
  });
});
