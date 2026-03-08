using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
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
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            var subClaim =
                user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                ?? user.FindFirst("sub")?.Value
                ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId) || !Guid.TryParse(subClaim, out var userId))
            {
                return Results.Unauthorized();
            }

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(workspaceId, tenantId, ct))
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
                tenantId,
                workspaceId,
                userId,
                request.Question,
                topK,
                mode,
                languageHint);

            var result = await mediator.Send(command, ct);

            var log = loggerFactory.CreateLogger("DocumentIntelligence.Ask");
            log.LogInformation(
                "Ask completed: WorkspaceId={WorkspaceId}, TenantId={TenantId}, LatencyMs={LatencyMs}, SourceCount={SourceCount}",
                workspaceId, tenantId, result.LatencyMs, result.Sources.Count);

            return Results.Ok(result);
        });

        return routes;
    }
}

