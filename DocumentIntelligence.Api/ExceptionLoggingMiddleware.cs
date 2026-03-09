using Serilog.Context;

namespace DocumentIntelligence.Api;

/// <summary>
/// Catches unhandled exceptions, logs them with correlation ID, and returns a generic 500 response.
/// </summary>
public sealed class ExceptionLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionLoggingMiddleware> _logger;

    public ExceptionLoggingMiddleware(RequestDelegate next, ILogger<ExceptionLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
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

            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsJsonAsync(new
                {
                    type = "https://tools.ietf.org/html/rfc7231#section-6.6.1",
                    title = "An error occurred",
                    status = 500,
                    correlationId,
                    detail = ex.ToString()
                });
            }
            else
            {
                throw;
            }
        }
    }
}
