using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapLayouts;

public record GetMapLayoutsQuery(string Location) : IRequest<Result<IReadOnlyList<MapLayoutSummaryDto>>>;
