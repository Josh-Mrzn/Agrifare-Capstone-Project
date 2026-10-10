/**
 * Makes user text match literally inside a RegExp or a Mongo $regex.
 *
 * Without it a search for "(" is a broken pattern (a 500), and a crafted one
 * like "(a+)+$" makes the database backtrack over every product.
 */
export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
