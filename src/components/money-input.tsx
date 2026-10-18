import { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

/** "1250000" (or "1250000.00" from the API) -> "1.250.000"; empty stays empty. */
export function formatMoneyInput(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Math.trunc(Number(value));
  return Number.isFinite(amount) ? String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
}

/** Typed text -> plain digits for state and the API ("1.250.000" -> "1250000"). */
export const parseMoneyInput = (text: string) => {
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.slice(0, 13);
};

type MoneyInputProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  /** Plain digits, e.g. "1250000". */
  value: string;
  onChangeText?: (digits: string) => void;
};

/** Rupiah amount field: shows thousand separators while state keeps plain digits. */
export const MoneyInput = forwardRef<TextInput, MoneyInputProps>(function MoneyInput({ value, onChangeText, placeholder, ...props }, ref) {
  return <TextInput
    ref={ref}
    {...props}
    keyboardType="number-pad"
    value={formatMoneyInput(value)}
    onChangeText={onChangeText ? (text) => onChangeText(parseMoneyInput(text)) : undefined}
    placeholder={placeholder && /^\d+(\.\d+)?$/.test(placeholder) ? formatMoneyInput(placeholder) : placeholder}
  />;
});
