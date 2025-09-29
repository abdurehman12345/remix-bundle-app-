import { run } from '@shopify/shopify_function';

function getAttribute(attrs, key) {
  if (!Array.isArray(attrs)) return null;
  const found = attrs.find(a => a && a.key === key);
  return found && typeof found.value === 'string' ? found.value : null;
}

run((input) => {
  const attrs = (input && input.cart && input.cart.attributes) || [];
  const centsStr = getAttribute(attrs, 'additional_charges_cents') || '0';
  const cents = parseInt(centsStr, 10) || 0;

  if (cents <= 0) {
    return { operations: [] };
  }

  const wrapName = getAttribute(attrs, 'gift_wrap_name') || '';
  const cardName = getAttribute(attrs, 'gift_card_name') || '';
  const details = [wrapName, cardName].filter(Boolean).join(' + ');
  const titleBase = 'Gift services';
  const title = details ? `${titleBase} (${details})` : titleBase;

  const currency = (input && input.cart && input.cart.cost && input.cart.cost.totalAmount && input.cart.cost.totalAmount.currencyCode)
    || (input && input.shop && input.shop.currencyCode)
    || 'USD';

  const amount = (cents / 100).toFixed(2);

  return {
    operations: [
      {
        addLineItem: {
          title,
          price: {
            amount,
            currencyCode: currency,
          },
          metadata: [
            { key: 'source', value: 'bundle-app' },
            { key: 'wrap', value: wrapName || '' },
            { key: 'card', value: cardName || '' },
            { key: 'cents', value: String(cents) },
          ],
        },
      },
    ],
  };
});


