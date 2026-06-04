// Visibility model for uploaded ("private") sets.
//
// A set is PUBLIC iff `set.standard === true`. Official/imported sets are
// standard:true. A user-uploaded set is standard:false and is PRIVATE — visible
// and playable only by its owner, identified by `set.owner` (the uploader's
// stable `users._id`). The owner id is stored on the `sets` document and
// mirrored onto the embedded `set` sub-document of every tossup/bonus (exactly
// like `standard` already is), so the read paths can filter without a join.
//
// `viewerId` conventions used across the read helpers:
//   - an ObjectId  -> standard sets + sets owned by that user
//   - null         -> anonymous / logged-out: standard (public) sets only  [SAFE DEFAULT]
//   - undefined    -> INTERNAL, already-authorized caller: no restriction.
//                     Only used where the set was authorized elsewhere (e.g. a
//                     multiplayer room after its owner selected the set).

/**
 * Filter fragment over the TOP-LEVEL fields of the `sets` collection.
 * @param {import('mongodb').ObjectId|null|undefined} viewerId
 */
function setDocFilter (viewerId) {
  if (viewerId === undefined) return {};
  return viewerId
    ? { $or: [{ standard: true }, { owner: viewerId }] }
    : { standard: true };
}

/**
 * Clause over the EMBEDDED `set` sub-document on tossups/bonuses. Returns a
 * single clause object; push it into a top-level `$and` array so it composes
 * with any existing query conditions. Returns `{}` (matches everything) for an
 * internal/trusted caller (viewerId === undefined).
 * @param {import('mongodb').ObjectId|null|undefined} viewerId
 */
function embeddedSetFilter (viewerId) {
  if (viewerId === undefined) return {};
  return viewerId
    ? { $or: [{ 'set.standard': true }, { 'set.owner': viewerId }] }
    : { 'set.standard': true };
}

/**
 * Post-fetch visibility check for a document's embedded `set` object.
 * @param {{ standard?: boolean, owner?: import('mongodb').ObjectId }} set
 * @param {import('mongodb').ObjectId|null|undefined} viewerId
 * @returns {boolean}
 */
function isSetVisible (set, viewerId) {
  if (viewerId === undefined) return true;
  if (set?.standard === true) return true;
  if (!viewerId || !set?.owner) return false;
  return typeof set.owner.equals === 'function'
    ? set.owner.equals(viewerId)
    : String(set.owner) === String(viewerId);
}

export { setDocFilter, embeddedSetFilter, isSetVisible };
