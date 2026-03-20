import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

export abstract class BasePlugin {
  abstract readonly name: string;

  /**
   * Fetch raw data from the source and store new items in raw_items.
   * Returns the number of new items inserted (0 if all were duplicates).
   */
  abstract collect(db: Database.Database): Promise<number>;

  /**
   * Read pending raw_items for this plugin, build Slack blocks, and store
   * the result as a pending outbound_message.
   * Returns the outbound_message id if a digest was built, else null.
   */
  abstract buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null>;
}
