import type { HeadingBlock as Heading } from '../../lib/contract';
import styles from './Text.module.css';

/** Levels 2–4 only: the page owns the h1. */
export function HeadingBlock({ block }: { block: Heading }) {
  const Tag = `h${block.level}` as const;
  return <Tag className={styles.heading}>{block.text}</Tag>;
}
