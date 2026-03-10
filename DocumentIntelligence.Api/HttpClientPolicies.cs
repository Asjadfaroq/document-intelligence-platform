using System.Net;
using System.Net.Http;
using Polly;
using Polly.Extensions.Http;

namespace DocumentIntelligence.Api;

internal static class HttpClientPolicies
{
    public static IAsyncPolicy<HttpResponseMessage> CreateRetryPolicy()
    {
        // Consider HTTP 5xx, 408, network failures, and 429 as transient.
        var transientHttpErrorPolicy = HttpPolicyExtensions
            .HandleTransientHttpError()
            .OrResult(msg => msg.StatusCode == HttpStatusCode.TooManyRequests);

        return transientHttpErrorPolicy.WaitAndRetryAsync(
            retryCount: 3,
            sleepDurationProvider: retryAttempt =>
            {
                var baseDelay = TimeSpan.FromSeconds(Math.Pow(2, retryAttempt - 1)); // 1s, 2s, 4s
                var jitterMs = Random.Shared.Next(0, 250);
                return baseDelay + TimeSpan.FromMilliseconds(jitterMs);
            });
    }
}

