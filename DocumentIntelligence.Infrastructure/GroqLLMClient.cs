using System.Text;
using System.Text.Json;
using DocumentIntelligence.Application;
using Microsoft.Extensions.Configuration;

namespace DocumentIntelligence.Infrastructure;

public class GroqLLMClient : ILLMClient
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public GroqLLMClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    public async Task<string> GenerateAnswerAsync(string question, string context, string? languageHint, CancellationToken cancellationToken)
    {
        var apiKey = ConfigHelpers.Sanitize(_configuration["GROQ_API_KEY"]);
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("GROQ_API_KEY is not configured.");

        var model = ConfigHelpers.Sanitize(_configuration["GROQ_MODEL"]).Trim();
        if (string.IsNullOrWhiteSpace(model))
            model = "llama-3.3-70b-versatile";

        var systemContent = RagPrompt.BuildSystemContent(languageHint);
        var userContent = RagPrompt.BuildUserContent(question, context);

        var payload = new
        {
            model,
            messages = new[] { new { role = "system", content = systemContent }, new { role = "user", content = userContent } },
            max_tokens = 512,
            temperature = 0.2
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        var response = await _httpClient.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Groq LLM error ({response.StatusCode}): {json}");

        return OpenAiChatResponse.ParseContent(json);
    }
}
