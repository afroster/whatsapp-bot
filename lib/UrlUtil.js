
class UrlUtil {
  static extract(text) {
    if (typeof text !== 'string' || !text.trim()) return [];

    const regex = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

    return [...new Set(
      (text.match(regex) || []).map(url =>
        url.replace(/[.,!?;:)]+$/, '')
      )
    )];
  }
}

module.exports = UrlUtil;
