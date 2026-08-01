-- Enforce front/back uniqueness per deck at the database level. A plain btree
-- index on the raw text columns would risk exceeding Postgres's index-entry
-- size limit for 2000-char fields, so the index is built over a hash instead.

create unique index cards_deck_id_front_back_hash_idx
  on cards (deck_id, (md5(front) || md5(back)));
