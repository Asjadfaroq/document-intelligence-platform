using System.Text.Json;

namespace DocumentIntelligence.Infrastructure;

internal static class ConfigHelpers
{
    /// <summary>Strips control characters from env/config values for safe use in headers and URLs.</summary>
    public static string Sanitize(string? value) =>
        string.IsNullOrEmpty(value) ? string.Empty : string.Concat(value.Trim().Where(c => !char.IsControl(c)));
}

internal static class RagPrompt
{
    private const string BaseSystem =
        "You are a precise document Q&A assistant for any document type (contracts, reports, invoices, manuals, research, etc.). Answer ONLY using the provided context.\n\n" +
        "CRITICAL: Base your answer strictly on the context below. Do not infer, assume, or fabricate. " +
        "If the information is NOT in the context, say you could not find it. Never state that something is absent; " +
        "only say you could not find it in the given context.\n\n" +
        "For lists and structured data (entities, amounts, clauses, dates, etc.): include ALL relevant matches from the context. Do not omit any item.\n" +
        "For yes/no questions: answer only Yes or No based on explicit evidence in the context.";

    public static string GetLanguageInstruction(string? languageHint) =>
        string.IsNullOrWhiteSpace(languageHint)
            ? ""
            : languageHint.Trim().Equals("ar", StringComparison.OrdinalIgnoreCase)
                ? " Answer in Arabic only."
                : " Answer in English only.";

    public static string BuildSystemContent(string? languageHint) => BaseSystem + GetLanguageInstruction(languageHint);

    public static string BuildUserContent(string question, string context) =>
        $"Context:\n{context}\n\nQuestion: {question}\n\nAnswer:";
}

internal static class OpenAiChatResponse
{
    public static string ParseContent(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString()?.Trim() ?? string.Empty;
    }
}
