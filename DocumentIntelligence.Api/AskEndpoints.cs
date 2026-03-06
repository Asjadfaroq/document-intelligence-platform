using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using DocumentIntelligence.Application;
using MediatR;

namespace DocumentIntelligence.Api;

public record AskRequestDto(string Question, int TopK, string? Mode);

public static class AskEndpoints
{
    public static IEndpointRouteBuilder MapAsk(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/workspaces/{workspaceId:guid}/ask")
            .RequireAuthorization();

        group.MapPost(string.Empty, async (
            Guid workspaceId,
            AskRequestDto request,
            ClaimsPrincipal user,
            IMediator mediator,
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

            var topK = request.TopK <= 0 ? 5 : Math.Min(request.TopK, 10);
            var mode = string.Equals(request.Mode, "hybrid", StringComparison.OrdinalIgnoreCase)
                ? AskSearchMode.Hybrid
                : AskSearchMode.Vector;

            var command = new AskQuestionCommand(
                tenantId,
                workspaceId,
                userId,
                request.Question,
                topK,
                mode);

            var result = await mediator.Send(command, ct);
            return Results.Ok(result);
        });

        return routes;
    }
}

