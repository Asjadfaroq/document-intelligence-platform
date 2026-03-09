using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;

namespace DocumentIntelligence.Api;

public record AskRequestDto(string Question, int TopK, string? Mode, string? LanguageHint);

public static class AskEndpoints
{
    public static IEndpointRouteBuilder MapAsk(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/workspaces/{workspaceId:guid}/ask")
            .RequireAuthorization("TenantUser");

        group.MapPost(string.Empty, async (
            Guid workspaceId,
            AskRequestDto request,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            IRateLimitService rateLimit,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var tenantId = user.GetTenantId();
            var userId = user.GetUserId();
            if (tenantId == null || userId == null)
                return Results.Unauthorized();

            var log = loggerFactory.CreateLogger("DocumentIntelligence.Ask");

            // Redis-backed rate limiting: 3 questions per 30 seconds per user+tenant
            var clientKey = $"{tenantId}:{userId}";
            if (!await rateLimit.AllowAsync("ask", clientKey, 3, 30, ct))
            {
                log.LogWarning("Ask rate limited: Key={Key}", clientKey);
                return Results.Json(new { title = "Too many questions. Please wait a bit and try again.", status = 429 }, statusCode: 429);
            }

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(workspaceId, tenantId.Value, ct))
            {
                return Results.Forbid();
            }

            var topK = request.TopK <= 0 ? 5 : Math.Min(request.TopK, 10);
            var mode = string.Equals(request.Mode, "hybrid", StringComparison.OrdinalIgnoreCase)
                ? AskSearchMode.Hybrid
                : AskSearchMode.Vector;

            var languageHint = string.IsNullOrWhiteSpace(request.LanguageHint)
                ? null
                : request.LanguageHint!.Trim();

            var command = new AskQuestionCommand(
                tenantId.Value,
                workspaceId,
                userId.Value,
                request.Question,
                topK,
                mode,
                languageHint);

            var result = await mediator.Send(command, ct);
            log.LogInformation(
                "Ask completed: WorkspaceId={WorkspaceId}, TenantId={TenantId}, LatencyMs={LatencyMs}, SourceCount={SourceCount}",
                workspaceId, tenantId.Value, result.LatencyMs, result.Sources.Count);

            return Results.Ok(result);
        });

        return routes;
    }
}

