import styles from './Text.module.css';

/**
 * Rendered for a block type outside the contract. It stays visible (a silent gap
 * would hide a contract drift) and never throws.
 */
export function UnknownBlock({ block }: { block: { type?: unknown } }) {
  const type = typeof block.type === 'string' ? block.type : 'missing type';
  return (
    <div className={styles.unknown} role="note" data-block-unknown={type}>
      <strong>Unsupported block “{type}”.</strong> This part of the distillation uses a block
      type the reader doesn’t know yet.
      {import.meta.env.DEV ? <pre>{JSON.stringify(block, null, 2)}</pre> : null}
    </div>
  );
}
