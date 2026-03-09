using Microsoft.AspNetCore.Mvc;
using Serilog.Context;

namespace DocumentIntelligence.Api;

/// <summary>
/// Catches unhandled exceptions, logs them with correlation ID, and returns a generic 500 response.
/// </summary>
    public sealed class ExceptionLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionLoggingMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    public ExceptionLoggingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionLoggingMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

        public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            var correlationId = context.Items.TryGetValue(CorrelationIdMiddleware.CorrelationIdItemKey, out var id)
                ? id?.ToString()
                : null;

            using (LogContext.PushProperty("CorrelationId", correlationId))
            {
                _logger.LogError(ex, "Unhandled exception: {Message}", ex.Message);
            }

            if (context.Response.HasStarted)
            {
                // If the response has already started we can't change it safely.
                throw;
            }

            var problem = CreateProblemDetails(context, ex, correlationId);

            context.Response.Clear();
            context.Response.StatusCode = problem.Status ?? StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(problem);
        }
    }

    private ProblemDetails CreateProblemDetails(HttpContext context, Exception exception, string? correlationId)
    {
        // Default mapping – can be extended with domain-specific exception types later.
        var status = StatusCodes.Status500InternalServerError;
        var title = "An unexpected error occurred.";
        var type = "https://tools.ietf.org/html/rfc7231#section-6.6.1";

        // HuggingFace API credits exhausted – return 402 with user-friendly message
        if (exception.Message.StartsWith("HUGGINGFACE_CREDITS_EXHAUSTED:", StringComparison.Ordinal))
        {
            status = StatusCodes.Status402PaymentRequired;
            title = "AI service credits exhausted";
            type = "https://tools.ietf.org/html/rfc7231#section-6.5.2";
        }

        var detail = status == StatusCodes.Status402PaymentRequired
            ? "AI service credits are out of stock. Please try again later or contact your administrator."
            : (_environment.IsDevelopment() ? exception.ToString() : exception.Message);

        var problem = new ProblemDetails
        {
            Type = type,
            Title = title,
            Detail = detail,
            Status = status,
            Instance = context.Request.Path
        };

        var traceId = context.TraceIdentifier;
        if (!string.IsNullOrEmpty(traceId))
        {
            problem.Extensions["traceId"] = traceId;
        }

        if (!string.IsNullOrEmpty(correlationId))
        {
            problem.Extensions["correlationId"] = correlationId;
        }

        return problem;
    }
}
